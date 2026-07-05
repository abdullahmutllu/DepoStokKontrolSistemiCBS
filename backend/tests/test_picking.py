"""Picker routing: policy correctness on a hand-verifiable mini layout."""

import pytest

from app.services import stock_service


@pytest.fixture
def pick_env(client, org_factory, user_factory, warehouse_factory, auth_headers, layout_factory):
    org = org_factory("Pick Org")
    user = user_factory(org)
    headers = auth_headers(user)
    wh = warehouse_factory(org, width=20, depth=20)
    # Two aisles (rows 2 and 8 → y bands 1.0m and 4.0m), 2 shelves × 3 bins each.
    _, bins = layout_factory(org, wh, racks=2, shelves=2, bins=3)
    # Ground-level bins only (pos_z == 0) keep the walking model clean.
    ground = sorted(
        [b for b in bins if b.pos_z == 0], key=lambda b: (b.pos_y, b.pos_x)
    )
    return org, user, headers, wh, ground


class TestPickRoute:
    def test_policies_return_same_stops_and_best_is_minimal(self, client, pick_env):
        _, _, headers, wh, ground = pick_env
        chosen = [ground[0].id, ground[2].id, ground[3].id, ground[5].id]
        data = client.post(
            f"/api/v1/warehouses/{wh.id}/pick-route",
            json={"location_ids": chosen},
            headers=headers,
        ).json()

        assert data["pick_count"] == 4
        policies = {r["policy"]: r for r in data["routes"]}
        assert set(policies) == {"s_shape", "largest_gap", "optimized"}
        for route in policies.values():
            assert {s["location_id"] for s in route["stops"]} == set(chosen)
            assert route["total_m"] > 0
            assert len(route["path"]) >= 3
            # path starts and ends at the depot (door mid-south)
            assert route["path"][0]["x"] == pytest.approx(wh.local_width / 2)
            assert route["path"][0]["y"] == pytest.approx(0.0)
            assert route["path"][-1]["y"] == pytest.approx(0.0)

        best = min(policies.values(), key=lambda r: r["total_m"])
        assert data["best_policy"] == best["policy"]
        # optimized never loses to s_shape
        assert policies["optimized"]["total_m"] <= policies["s_shape"]["total_m"] + 1e-6

    def test_single_aisle_route_distance_is_hand_checkable(self, client, pick_env):
        _, _, headers, wh, ground = pick_env
        # Two picks in the SAME aisle: depot(10,0) → corridor → both picks → back.
        same_aisle = [b for b in ground if b.pos_y == ground[0].pos_y][:2]
        data = client.post(
            f"/api/v1/warehouses/{wh.id}/pick-route",
            json={"location_ids": [b.id for b in same_aisle]},
            headers=headers,
        ).json()
        opt = next(r for r in data["routes"] if r["policy"] == "optimized")
        # Manhattan lower bound: out to aisle y and back + horizontal span.
        aisle_y = same_aisle[0].pos_y + same_aisle[0].dim_d / 2
        assert opt["total_m"] >= 2 * aisle_y  # must at least go there and back
        assert opt["total_m"] < 80  # sanity ceiling for a 20m warehouse

    def test_order_items_resolve_to_stocked_bins(self, client, pick_env, product_factory, db):
        org, user, headers, wh, ground = pick_env
        product = product_factory(org)
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=ground[4].id, quantity=9,
        )
        db.commit()
        data = client.post(
            f"/api/v1/warehouses/{wh.id}/pick-route",
            json={"items": [{"product_id": product.id, "quantity": 3}]},
            headers=headers,
        ).json()
        stop = data["routes"][0]["stops"][0]
        assert stop["location_id"] == ground[4].id
        assert stop["product_sku"] == product.sku
        assert stop["quantity"] == 3

    def test_empty_and_missing_rejected(self, client, pick_env, product_factory):
        org, _, headers, wh, _ = pick_env
        assert (
            client.post(
                f"/api/v1/warehouses/{wh.id}/pick-route", json={}, headers=headers
            ).status_code
            == 422
        )
        unstocked = product_factory(org)
        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/pick-route",
            json={"items": [{"product_id": unstocked.id, "quantity": 1}]},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_org_isolation(
        self, client, pick_env, org_factory, user_factory, auth_headers
    ):
        _, _, _, wh, ground = pick_env
        headers_b = auth_headers(user_factory(org_factory("B")))
        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/pick-route",
            json={"location_ids": [ground[0].id]},
            headers=headers_b,
        )
        assert resp.status_code == 404

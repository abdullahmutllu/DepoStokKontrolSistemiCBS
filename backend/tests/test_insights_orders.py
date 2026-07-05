"""Talep tahmini, reorder önerileri, KPI ve sipariş/dalga toplama uçları."""

import pytest


@pytest.fixture
def ops_env(db, org_factory, user_factory, warehouse_factory, product_factory, layout_factory):
    org = org_factory()
    user = user_factory(org)
    warehouse = warehouse_factory(org)
    p1 = product_factory(org, threshold=20)
    p2 = product_factory(org, threshold=0)
    _, bins = layout_factory(org, warehouse)
    return org, user, warehouse, p1, p2, bins


def _receive(client, headers, product_id, location_id, qty):
    r = client.post(
        "/api/v1/stock/receive",
        json={"product_id": product_id, "location_id": location_id, "quantity": qty},
        headers=headers,
    )
    assert r.status_code == 200


class TestForecast:
    def test_series_shape_and_reorder_point(self, client, auth_headers, ops_env):
        _, user, _, p1, _, bins = ops_env
        headers = auth_headers(user)
        _receive(client, headers, p1.id, bins[0].id, 100)
        # tüketim üret: 3 pick
        for qty in (5, 3, 7):
            r = client.post(
                "/api/v1/stock/pick",
                json={"product_id": p1.id, "location_id": bins[0].id, "quantity": qty},
                headers=headers,
            )
            assert r.status_code == 200

        data = client.get(f"/api/v1/products/{p1.id}/forecast", headers=headers).json()
        assert data["current_stock"] == 85
        actual = [p for p in data["series"] if p["kind"] == "actual"]
        forecast = [p for p in data["series"] if p["kind"] == "forecast"]
        assert len(actual) == 30 and len(forecast) == 14
        assert sum(p["quantity"] for p in actual) == 15  # bugünkü pick'ler seride
        assert data["reorder_point"] >= 0
        assert data["daily_avg"] == pytest.approx(0.5, abs=0.01)  # 15/30

    def test_org_isolation(self, client, auth_headers, ops_env, org_factory, user_factory):
        _, _, _, p1, _, _ = ops_env
        stranger = user_factory(org_factory())
        r = client.get(f"/api/v1/products/{p1.id}/forecast", headers=auth_headers(stranger))
        assert r.status_code == 404


class TestReorderSuggestions:
    def test_low_product_is_suggested(self, client, auth_headers, ops_env):
        _, user, _, p1, _, bins = ops_env
        headers = auth_headers(user)
        _receive(client, headers, p1.id, bins[0].id, 10)  # 10 <= eşik 20

        rows = client.get("/api/v1/reports/reorder-suggestions", headers=headers).json()
        skus = [r["sku"] for r in rows]
        assert p1.sku in skus
        row = next(r for r in rows if r["sku"] == p1.sku)
        assert row["reorder_point"] >= 20
        assert row["suggested_order_qty"] >= row["reorder_point"] - 10


class TestKpi:
    def test_counts_match_movements(self, client, auth_headers, ops_env):
        _, user, _, p1, _, bins = ops_env
        headers = auth_headers(user)
        _receive(client, headers, p1.id, bins[0].id, 50)
        client.post(
            "/api/v1/stock/pick",
            json={"product_id": p1.id, "location_id": bins[0].id, "quantity": 8},
            headers=headers,
        )
        kpi = client.get("/api/v1/reports/kpi", headers=headers).json()
        assert kpi["inbound_units_30d"] == 50
        assert kpi["outbound_units_30d"] == 8
        assert kpi["occupancy_percent"] > 0
        assert kpi["busiest_product_sku"] == p1.sku


class TestOrdersWave:
    def test_create_list_and_wave_pick(self, client, auth_headers, ops_env):
        _, user, warehouse, p1, p2, bins = ops_env
        headers = auth_headers(user)
        _receive(client, headers, p1.id, bins[0].id, 40)
        _receive(client, headers, p2.id, bins[2].id, 25)

        ids = []
        for customer, lines in (
            ("Aslan Market", [{"product_id": p1.id, "quantity": 5}]),
            ("Kaya Oto", [
                {"product_id": p1.id, "quantity": 3},
                {"product_id": p2.id, "quantity": 4},
            ]),
        ):
            r = client.post(
                "/api/v1/orders",
                json={"warehouse_id": warehouse.id, "customer_name": customer, "lines": lines},
                headers=headers,
            )
            assert r.status_code == 201
            assert r.json()["code"].startswith("SIP-")
            ids.append(r.json()["id"])

        listed = client.get("/api/v1/orders", headers=headers).json()
        assert len(listed) == 2

        wave = client.post(
            "/api/v1/orders/wave-pick", json={"order_ids": ids}, headers=headers
        ).json()
        # ürün bazında birleşti: p1 = 5+3 = 8
        line_p1 = next(ln for ln in wave["lines"] if ln["product_id"] == p1.id)
        assert line_p1["total_quantity"] == 8
        assert line_p1["location_code"] is not None
        assert wave["route"] is not None
        assert wave["route"]["best_policy"] in {"s_shape", "largest_gap", "optimized"}
        # siparişler dalgaya alındı
        after = client.get("/api/v1/orders?status=waved", headers=headers).json()
        assert len(after) == 2

    def test_wave_requires_single_warehouse(
        self, client, auth_headers, ops_env, warehouse_factory
    ):
        org, user, warehouse, p1, _, bins = ops_env
        headers = auth_headers(user)
        _receive(client, headers, p1.id, bins[0].id, 10)
        other_wh = warehouse_factory(org)
        r1 = client.post(
            "/api/v1/orders",
            json={
                "warehouse_id": warehouse.id,
                "customer_name": "A",
                "lines": [{"product_id": p1.id, "quantity": 1}],
            },
            headers=headers,
        ).json()
        r2 = client.post(
            "/api/v1/orders",
            json={
                "warehouse_id": other_wh.id,
                "customer_name": "B",
                "lines": [{"product_id": p1.id, "quantity": 1}],
            },
            headers=headers,
        ).json()
        r = client.post(
            "/api/v1/orders/wave-pick",
            json={"order_ids": [r1["id"], r2["id"]]},
            headers=headers,
        )
        assert r.status_code == 422

    def test_org_isolation(self, client, auth_headers, ops_env, org_factory, user_factory):
        _, user, warehouse, p1, _, _ = ops_env
        headers = auth_headers(user)
        order = client.post(
            "/api/v1/orders",
            json={
                "warehouse_id": warehouse.id,
                "customer_name": "Gizli",
                "lines": [{"product_id": p1.id, "quantity": 1}],
            },
            headers=headers,
        ).json()
        stranger = user_factory(org_factory())
        assert client.get("/api/v1/orders", headers=auth_headers(stranger)).json() == []
        r = client.post(
            "/api/v1/orders/wave-pick",
            json={"order_ids": [order["id"]]},
            headers=auth_headers(stranger),
        )
        assert r.status_code == 422

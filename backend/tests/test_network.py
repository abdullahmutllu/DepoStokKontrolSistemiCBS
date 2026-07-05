"""Customers CRUD + network analyses: weighted CoG, closest facility, coverage
(rings + mocked ORS isochrones), flow map — with org isolation throughout."""

import pytest

from app.services import ors, stock_service


@pytest.fixture
def net_env(client, org_factory, user_factory, warehouse_factory, auth_headers):
    org = org_factory("Net Org")
    user = user_factory(org)
    headers = auth_headers(user)
    # Two warehouses: Ankara & İstanbul
    wh_ank = warehouse_factory(org, name="Ankara D", lat=39.93, lng=32.86)
    wh_ist = warehouse_factory(org, name="İstanbul D", lat=41.01, lng=28.98)

    def add_customer(name, lat, lng, weight=1):
        resp = client.post(
            "/api/v1/customers",
            json={"name": name, "location": {"lat": lat, "lng": lng}, "weight": weight},
            headers=headers,
        )
        assert resp.status_code == 201
        return resp.json()

    return org, user, headers, wh_ank, wh_ist, add_customer


class TestCustomers:
    def test_crud_and_isolation(
        self, client, net_env, org_factory, user_factory, auth_headers
    ):
        _, _, headers, _, _, add_customer = net_env
        created = add_customer("Konya Bayi", 37.87, 32.49, 7)
        assert created["weight"] == 7

        listing = client.get("/api/v1/customers", headers=headers).json()
        assert [c["name"] for c in listing] == ["Konya Bayi"]

        updated = client.patch(
            f"/api/v1/customers/{created['id']}", json={"weight": 9}, headers=headers
        )
        assert updated.json()["weight"] == 9

        # Org B sees nothing and cannot touch A's customer.
        org_b = org_factory("B")
        headers_b = auth_headers(user_factory(org_b))
        assert client.get("/api/v1/customers", headers=headers_b).json() == []
        assert (
            client.delete(f"/api/v1/customers/{created['id']}", headers=headers_b).status_code
            == 404
        )
        assert (
            client.delete(f"/api/v1/customers/{created['id']}", headers=headers).status_code
            == 204
        )

    def test_csv_import(self, client, net_env):
        _, _, headers, _, _, _ = net_env
        csv_content = (
            "name,lat,lng,weight,city\n"
            "Bursa Bayi,40.19,29.06,10,Bursa\n"
            "Bozuk Satır,not-a-number,29.0,1,\n"
            "Antalya Bayi,36.90,30.71,,Antalya\n"
        )
        result = client.post(
            "/api/v1/customers/import-csv",
            files={"file": ("musteriler.csv", csv_content.encode("utf-8"), "text/csv")},
            headers=headers,
        ).json()
        assert result["created"] == 2
        assert len(result["errors"]) == 1
        # Re-import updates by name instead of duplicating.
        again = client.post(
            "/api/v1/customers/import-csv",
            files={"file": ("musteriler.csv", csv_content.encode("utf-8"), "text/csv")},
            headers=headers,
        ).json()
        assert again["created"] == 0
        assert again["updated"] == 2


class TestCenterOfGravity:
    def test_single_site_lands_at_weighted_center(self, client, net_env):
        _, _, headers, _, _, add_customer = net_env
        # Symmetric pair around lat 39, lng 30/34 with equal weights →
        # CoG ≈ midpoint (39, 32).
        add_customer("Batı", 39.0, 30.0, 5)
        add_customer("Doğu", 39.0, 34.0, 5)
        data = client.post(
            "/api/v1/network/center-of-gravity", json={"n_sites": 1}, headers=headers
        ).json()
        site = data["proposed_sites"][0]["location"]
        assert site["lat"] == pytest.approx(39.0, abs=0.05)
        assert site["lng"] == pytest.approx(32.0, abs=0.05)
        assert data["proposed_sites"][0]["assigned_customers"] == 2

    def test_weight_pulls_the_center(self, client, net_env):
        _, _, headers, _, _, add_customer = net_env
        add_customer("Hafif", 39.0, 30.0, 1)
        add_customer("Ağır", 39.0, 34.0, 9)
        data = client.post(
            "/api/v1/network/center-of-gravity", json={"n_sites": 1}, headers=headers
        ).json()
        # 0.1*30 + 0.9*34 = 33.6
        assert data["proposed_sites"][0]["location"]["lng"] == pytest.approx(33.6, abs=0.05)

    def test_two_sites_separate_clusters(self, client, net_env):
        _, _, headers, _, _, add_customer = net_env
        # Two far-apart clusters (Marmara vs Güneydoğu).
        add_customer("İst-1", 41.0, 29.0, 5)
        add_customer("İst-2", 40.9, 29.2, 5)
        add_customer("Gaziantep-1", 37.1, 37.4, 5)
        add_customer("Gaziantep-2", 37.0, 37.2, 5)
        data = client.post(
            "/api/v1/network/center-of-gravity", json={"n_sites": 2}, headers=headers
        ).json()
        lngs = sorted(s["location"]["lng"] for s in data["proposed_sites"])
        assert lngs[0] == pytest.approx(29.1, abs=0.3)
        assert lngs[1] == pytest.approx(37.3, abs=0.3)
        # Proposed 2 sites must beat the 2 real warehouses on weighted distance.
        assert data["proposed_total_weighted_km"] <= data["current_total_weighted_km"] + 1e-6

    def test_insufficient_customers_422(self, client, net_env):
        _, _, headers, _, _, add_customer = net_env
        add_customer("Tek", 39.0, 32.0, 1)
        resp = client.post(
            "/api/v1/network/center-of-gravity", json={"n_sites": 2}, headers=headers
        )
        assert resp.status_code == 422


class TestClosestFacility:
    def test_assignments_and_voronoi(self, client, net_env):
        _, _, headers, wh_ank, wh_ist, add_customer = net_env
        add_customer("Eskişehir Bayi", 39.78, 30.52, 4)  # İstanbul'dan çok Ankara'ya yakın? ~
        add_customer("Tekirdağ Bayi", 40.98, 27.51, 3)  # kesin İstanbul
        add_customer("Kayseri Bayi", 38.72, 35.49, 5)  # kesin Ankara

        data = client.get("/api/v1/network/closest-facility", headers=headers).json()
        by_customer = {a["customer_id"]: a for a in data["assignments"]}
        assert len(by_customer) == 3

        loads = {ld["warehouse_name"]: ld for ld in data["loads"]}
        # Tekirdağ → İstanbul, Kayseri → Ankara kesin.
        assert loads["İstanbul D"]["customer_count"] >= 1
        assert loads["Ankara D"]["customer_count"] >= 1
        total_assigned = sum(ld["customer_count"] for ld in data["loads"])
        assert total_assigned == 3

        # Two warehouses → two Voronoi territories, each a valid ring.
        assert len(data["territories"]) == 2
        for t in data["territories"]:
            assert len(t["ring"]) >= 4

    def test_org_isolation(self, client, net_env, org_factory, user_factory, auth_headers):
        _, _, headers_a, _, _, add_customer = net_env
        add_customer("A Bayi", 39.0, 32.0, 5)
        org_b = org_factory("B")
        headers_b = auth_headers(user_factory(org_b))
        # B has no warehouses → analysis rejects cleanly, never leaks A's data.
        resp = client.get("/api/v1/network/closest-facility", headers=headers_b)
        assert resp.status_code == 422


class TestCoverage:
    def test_rings_fallback_without_key(self, client, net_env, monkeypatch):
        _, _, headers, _, _, add_customer = net_env
        monkeypatch.setattr(ors, "_call_ors", lambda *a, **k: None)
        add_customer("Polatlı Bayi", 39.58, 32.15, 3)  # Ankara'ya ~60km → 50km dışı? ~61km
        add_customer("Sincan Bayi", 39.97, 32.65, 2)  # Ankara'ya ~18km → 25km bandı

        data = client.get("/api/v1/network/coverage", headers=headers).json()
        assert data["mode"] == "rings"
        ank = next(w for w in data["warehouses"] if w["warehouse_name"] == "Ankara D")
        assert [b["radius_km"] for b in ank["bands"]] == [10.0, 25.0, 50.0]
        # Sincan 25km bandında sayılmalı.
        band25 = next(b for b in ank["bands"] if b["radius_km"] == 25.0)
        assert band25["customer_count"] >= 1
        for band in ank["bands"]:
            assert len(band["ring"]) > 30  # quad_segs=16 → smooth circle

    def test_isochrone_mode_with_mock_and_cache(self, client, net_env, monkeypatch, db):
        _, _, headers, _, _, add_customer = net_env
        add_customer("Test Bayi", 39.9, 32.8, 2)
        calls = {"n": 0}

        def fake_ors(lng, lat, minutes):
            calls["n"] += 1
            return {
                "features": [
                    {
                        "properties": {"value": m * 60},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[
                                [lng - 0.2, lat - 0.2], [lng + 0.2, lat - 0.2],
                                [lng + 0.2, lat + 0.2], [lng - 0.2, lat + 0.2],
                                [lng - 0.2, lat - 0.2],
                            ]],
                        },
                    }
                    for m in minutes
                ]
            }

        monkeypatch.setattr(ors, "_call_ors", fake_ors)
        data = client.get("/api/v1/network/coverage", headers=headers).json()
        assert data["mode"] == "isochrone"
        first_calls = calls["n"]
        assert first_calls >= 1
        wh = data["warehouses"][0]
        assert wh["isochrones"] is not None
        assert [i["minutes"] for i in wh["isochrones"]] == [15, 30, 60]

        # Second request must be served from the cache — zero new API calls.
        client.get("/api/v1/network/coverage", headers=headers)
        assert calls["n"] == first_calls


class TestFlowMap:
    def test_transfer_arcs_between_warehouses(
        self, db, client, net_env, product_factory, layout_factory
    ):
        org, user, headers, wh_ank, wh_ist, _ = net_env
        product = product_factory(org)
        _, bins_ank = layout_factory(org, wh_ank)
        _, bins_ist = layout_factory(org, wh_ist)
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins_ank[0].id, quantity=30,
        )
        stock_service.transfer(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            from_location_id=bins_ank[0].id, to_location_id=bins_ist[0].id, quantity=12,
        )
        db.commit()

        data = client.get("/api/v1/network/flow-map", headers=headers).json()
        assert len(data["arcs"]) == 1
        arc = data["arcs"][0]
        assert arc["from_name"] == "Ankara D"
        assert arc["to_name"] == "İstanbul D"
        assert arc["total_quantity"] == 12
        assert arc["transfer_count"] == 1

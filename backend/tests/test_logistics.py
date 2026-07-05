"""VRP teslimat turları, canlı sevkiyat takibi (REST + WS) ve what-if senaryosu."""

import pytest

from app.core.security import create_access_token
from app.models import Customer
from app.schemas.warehouse import LatLng
from app.services.geo import latlng_to_point


@pytest.fixture
def network_env(db, org_factory, user_factory, warehouse_factory):
    """İki depo (Ankara, İstanbul) + Ankara çevresinde 4, İstanbul'da 2 müşteri."""
    org = org_factory()
    user = user_factory(org)
    ankara = warehouse_factory(org, lat=39.95, lng=32.85)
    istanbul = warehouse_factory(org, lat=41.05, lng=28.8)
    points = [
        ("Polatlı Bayi", 39.58, 32.14, 8),
        ("Kırıkkale Market", 39.84, 33.51, 6),
        ("Çankırı Depo", 40.6, 33.61, 4),
        ("Konya Toptan", 37.87, 32.49, 10),
        ("Kadıköy Market", 40.99, 29.03, 12),
        ("Bakırköy Bayi", 40.98, 28.87, 9),
    ]
    for name, lat, lng, weight in points:
        db.add(
            Customer(
                org_id=org.id,
                name=name,
                location=latlng_to_point(LatLng(lat=lat, lng=lng)),
                weight=weight,
            )
        )
    db.commit()
    return org, user, ankara, istanbul


class TestVehicleRoutes:
    def test_tours_cover_assigned_customers_within_capacity(
        self, client, auth_headers, network_env
    ):
        _, user, ankara, _ = network_env
        r = client.post(
            "/api/v1/network/vehicle-routes",
            json={"warehouse_id": ankara.id, "vehicle_count": 2, "capacity": 18},
            headers=auth_headers(user),
        )
        assert r.status_code == 200
        data = r.json()
        # Ankara'ya en yakın 4 müşteri turlara dağılır; İstanbul'unkiler girmez
        served = [s["name"] for t in data["tours"] for s in t["stops"]]
        assert sorted(served) == sorted(
            ["Polatlı Bayi", "Kırıkkale Market", "Çankırı Depo", "Konya Toptan"]
        )
        for tour in data["tours"]:
            assert tour["load"] <= 18
            assert tour["distance_km"] > 0
            assert tour["duration_min"] > tour["distance_km"] / 2  # servisler dahil
        assert data["total_km"] > 0

    def test_needs_at_least_two_customers(
        self, client, auth_headers, org_factory, user_factory, warehouse_factory
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org)
        r = client.post(
            "/api/v1/network/vehicle-routes",
            json={"warehouse_id": wh.id, "vehicle_count": 2, "capacity": 10},
            headers=auth_headers(user),
        )
        assert r.status_code == 422


class TestShipments:
    def _create(self, client, headers, warehouse_id, time_scale=240):
        tours = client.post(
            "/api/v1/network/vehicle-routes",
            json={"warehouse_id": warehouse_id, "vehicle_count": 2, "capacity": 18},
            headers=headers,
        ).json()["tours"]
        r = client.post(
            "/api/v1/shipments",
            json={"warehouse_id": warehouse_id, "tours": tours, "time_scale": time_scale},
            headers=headers,
        )
        assert r.status_code == 201
        return r.json()

    def test_lifecycle_live_position_and_detail(self, client, auth_headers, network_env):
        _, user, ankara, _ = network_env
        headers = auth_headers(user)
        created = self._create(client, headers, ankara.id)
        assert len(created) >= 1
        first = created[0]
        assert first["vehicle_name"] == "Araç 1"
        assert first["live"]["status"] in {"pending", "en_route", "at_stop"}
        # rota depot'ta başlayıp depot'ta biter
        assert first["route"][0] == first["route"][-1]

        active = client.get("/api/v1/shipments/active", headers=headers).json()
        assert len(active) == len(created)
        live = active[0]["live"]
        # Konum Türkiye zarfında ve ilerleme 0-100 bandında
        assert 35.0 < live["position"]["lat"] < 43.0
        assert 25.0 < live["position"]["lng"] < 45.0
        assert 0 <= live["progress_percent"] <= 100

        detail = client.get(
            f"/api/v1/shipments/{first['id']}", headers=headers
        ).json()
        assert len(detail["stops"]) == first["stop_count"]
        statuses = {s["status"] for s in detail["stops"]}
        assert statuses <= {"done", "current", "pending"}
        # planlanan varışlar artan sırada
        arrivals = [s["planned_arrive_min"] for s in detail["stops"]]
        assert arrivals == sorted(arrivals)

    def test_org_isolation_and_clear(
        self, client, auth_headers, network_env, org_factory, user_factory
    ):
        _, user, ankara, _ = network_env
        headers = auth_headers(user)
        self._create(client, headers, ankara.id)

        stranger = user_factory(org_factory())
        other = client.get("/api/v1/shipments/active", headers=auth_headers(stranger))
        assert other.json() == []

        assert client.delete("/api/v1/shipments", headers=headers).status_code == 204
        assert client.get("/api/v1/shipments/active", headers=headers).json() == []

    def test_websocket_pushes_snapshots(self, client, auth_headers, network_env):
        _, user, ankara, _ = network_env
        headers = auth_headers(user)
        self._create(client, headers, ankara.id)

        token = create_access_token(user.id, user.org_id, user.role)
        with client.websocket_connect(f"/api/v1/shipments/ws?token={token}") as ws:
            message = ws.receive_json()
        assert message["type"] == "shipments"
        assert len(message["data"]) >= 1
        assert "position" in message["data"][0]["live"]

    def test_websocket_rejects_bad_token(self, client, network_env):
        from starlette.websockets import WebSocketDisconnect

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/v1/shipments/ws?token=gecersiz") as ws:
                ws.receive_json()


class TestScenario:
    def test_closing_a_warehouse_worsens_weighted_distance(
        self, client, auth_headers, network_env
    ):
        _, user, ankara, istanbul = network_env
        r = client.post(
            "/api/v1/network/scenario",
            json={"closed_warehouse_ids": [istanbul.id]},
            headers=auth_headers(user),
        )
        assert r.status_code == 200
        data = r.json()
        assert data["delta_weighted_km"] > 0  # İstanbul müşterileri uzağa taşınır
        assert data["delta_percent"] > 0
        assert data["reassigned_customers"] == 2  # Kadıköy + Bakırköy
        assert len(data["scenario"]["loads"]) == 1  # yalnız Ankara kaldı

    def test_cannot_close_all(self, client, auth_headers, network_env):
        _, user, ankara, istanbul = network_env
        r = client.post(
            "/api/v1/network/scenario",
            json={"closed_warehouse_ids": [ankara.id, istanbul.id]},
            headers=auth_headers(user),
        )
        assert r.status_code == 422

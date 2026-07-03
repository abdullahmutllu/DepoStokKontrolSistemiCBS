"""Region analysis + saved regions: spatial correctness and org isolation."""

import pytest

from app.services import stock_service

# ~1.1 km square around Ankara Kızılay; contains (39.920, 32.850), excludes Istanbul.
SQUARE_RING = [
    {"lat": 39.915, "lng": 32.845},
    {"lat": 39.915, "lng": 32.855},
    {"lat": 39.925, "lng": 32.855},
    {"lat": 39.925, "lng": 32.845},
]


@pytest.fixture
def geo_env(org_factory, user_factory, warehouse_factory, auth_headers):
    org = org_factory("Geo Org")
    user = user_factory(org)
    inside_a = warehouse_factory(org, name="Ankara 1", lat=39.920, lng=32.850)
    inside_b = warehouse_factory(org, name="Ankara 2", lat=39.918, lng=32.852)
    outside = warehouse_factory(org, name="İstanbul", lat=41.06, lng=28.79)
    return org, user, auth_headers(user), inside_a, inside_b, outside


class TestRegionAnalysis:
    def test_only_warehouses_inside_polygon(self, client, geo_env):
        _, _, headers, inside_a, inside_b, outside = geo_env
        resp = client.post(
            "/api/v1/geo/region-analysis", json={"ring": SQUARE_RING}, headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        ids = {w["warehouse_id"] for w in data["warehouses"]}
        assert ids == {inside_a.id, inside_b.id}
        assert outside.id not in ids
        assert data["warehouse_count"] == 2

    def test_org_isolation_polygon_cannot_reach_other_orgs(
        self, client, geo_env, org_factory, user_factory, warehouse_factory
    ):
        _, _, headers_a, *_ = geo_env
        org_b = org_factory("Org B")
        user_factory(org_b)
        wh_b = warehouse_factory(org_b, name="B'nin Ankara deposu", lat=39.921, lng=32.851)

        resp = client.post(
            "/api/v1/geo/region-analysis", json={"ring": SQUARE_RING}, headers=headers_a
        )
        ids = {w["warehouse_id"] for w in resp.json()["warehouses"]}
        assert wh_b.id not in ids, "org B's warehouse leaked into org A's region analysis"

    def test_aggregates_match_stock(
        self, db, client, geo_env, product_factory, layout_factory
    ):
        org, user, headers, inside_a, _, _ = geo_env
        product = product_factory(org)
        _, bins = layout_factory(org, inside_a)  # 1 rack × 2 shelves × 3 bins = 6 bins
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=42,
        )
        db.commit()

        data = client.post(
            "/api/v1/geo/region-analysis", json={"ring": SQUARE_RING}, headers=headers
        ).json()
        assert data["total_quantity"] == 42
        assert data["total_bins"] == 6
        assert data["used_bins"] == 1
        row = next(w for w in data["warehouses"] if w["warehouse_id"] == inside_a.id)
        assert row["total_quantity"] == 42
        assert row["bin_count"] == 6

    def test_area_and_centroid_plausible(self, client, geo_env):
        _, _, headers, *_ = geo_env
        data = client.post(
            "/api/v1/geo/region-analysis", json={"ring": SQUARE_RING}, headers=headers
        ).json()
        # ~1.11km (lat) × ~0.85km (lng at 40°N) ≈ 0.95 km² — allow generous band.
        assert 0.5e6 < data["area_m2"] < 2e6
        assert 39.915 < data["centroid"]["lat"] < 39.925
        assert 32.845 < data["centroid"]["lng"] < 32.855
        # Two warehouses inside → positive pairwise distance, sub-km.
        assert 0 < data["max_pairwise_distance_m"] < 2000
        for w in data["warehouses"]:
            assert w["distance_to_centroid_m"] < 2000

    def test_degenerate_ring_rejected(self, client, geo_env):
        _, _, headers, *_ = geo_env
        two_points = SQUARE_RING[:2]
        resp = client.post(
            "/api/v1/geo/region-analysis", json={"ring": two_points}, headers=headers
        )
        assert resp.status_code == 422

        # Ring with duplicated vertices collapsing to a line → 422 from validator.
        line_ring = [SQUARE_RING[0], SQUARE_RING[1], SQUARE_RING[0], SQUARE_RING[1]]
        resp = client.post(
            "/api/v1/geo/region-analysis", json={"ring": line_ring}, headers=headers
        )
        assert resp.status_code == 422

    def test_pre_closed_ring_accepted(self, client, geo_env):
        _, _, headers, *_ = geo_env
        closed = [*SQUARE_RING, SQUARE_RING[0]]
        resp = client.post(
            "/api/v1/geo/region-analysis", json={"ring": closed}, headers=headers
        )
        assert resp.status_code == 200
        assert resp.json()["warehouse_count"] == 2

    def test_empty_region_returns_zeros(self, client, geo_env):
        _, _, headers, *_ = geo_env
        sahara = [
            {"lat": 20.0, "lng": 10.0},
            {"lat": 20.0, "lng": 10.1},
            {"lat": 20.1, "lng": 10.1},
        ]
        data = client.post(
            "/api/v1/geo/region-analysis", json={"ring": sahara}, headers=headers
        ).json()
        assert data["warehouse_count"] == 0
        assert data["total_quantity"] == 0
        assert data["warehouses"] == []
        assert data["max_pairwise_distance_m"] == 0


class TestRegionsCrud:
    def test_crud_roundtrip(self, client, geo_env):
        _, _, headers, *_ = geo_env
        created = client.post(
            "/api/v1/regions", json={"name": "İç Anadolu", "ring": SQUARE_RING}, headers=headers
        )
        assert created.status_code == 201
        region = created.json()
        assert region["name"] == "İç Anadolu"
        # Ring round-trips through PostGIS (closed ring comes back).
        assert len(region["ring"]) >= 4

        listing = client.get("/api/v1/regions", headers=headers).json()
        assert [r["id"] for r in listing] == [region["id"]]

        renamed = client.patch(
            f"/api/v1/regions/{region['id']}", json={"name": "Ankara Bölgesi"}, headers=headers
        )
        assert renamed.json()["name"] == "Ankara Bölgesi"

        assert (
            client.delete(f"/api/v1/regions/{region['id']}", headers=headers).status_code == 204
        )
        assert client.get("/api/v1/regions", headers=headers).json() == []

    def test_saved_ring_reanalyzes_identically(self, client, geo_env):
        _, _, headers, *_ = geo_env
        region = client.post(
            "/api/v1/regions", json={"name": "Test", "ring": SQUARE_RING}, headers=headers
        ).json()
        direct = client.post(
            "/api/v1/geo/region-analysis", json={"ring": SQUARE_RING}, headers=headers
        ).json()
        via_saved = client.post(
            "/api/v1/geo/region-analysis", json={"ring": region["ring"]}, headers=headers
        ).json()
        assert via_saved["warehouse_count"] == direct["warehouse_count"]
        assert via_saved["total_bins"] == direct["total_bins"]

    def test_cross_org_region_404(
        self, client, geo_env, org_factory, user_factory, auth_headers
    ):
        _, _, headers_a, *_ = geo_env
        region = client.post(
            "/api/v1/regions", json={"name": "A'nın bölgesi", "ring": SQUARE_RING},
            headers=headers_a,
        ).json()

        org_b = org_factory("Org B")
        headers_b = auth_headers(user_factory(org_b))
        rid = region["id"]
        assert client.get(f"/api/v1/regions/{rid}", headers=headers_b).status_code == 404
        assert (
            client.patch(
                f"/api/v1/regions/{rid}", json={"name": "Gasp"}, headers=headers_b
            ).status_code
            == 404
        )
        assert client.delete(f"/api/v1/regions/{rid}", headers=headers_b).status_code == 404
        # A still owns it.
        assert client.get(f"/api/v1/regions/{rid}", headers=headers_a).status_code == 200

class TestAuth:
    def test_register_creates_org_and_owner(self, client):
        resp = client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": "Yeni Firma",
                "email": "owner@firma.co",
                "password": "Sifre1234",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["access_token"]
        assert data["user"]["role"] == "owner"
        assert data["user"]["email"] == "owner@firma.co"

    def test_register_duplicate_email_conflicts(self, client):
        payload = {
            "organization_name": "Firma",
            "email": "dup@firma.co",
            "password": "Sifre1234",
        }
        assert client.post("/api/v1/auth/register", json=payload).status_code == 201
        resp = client.post("/api/v1/auth/register", json=payload)
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "CONFLICT"

    def test_login_wrong_password(self, client):
        client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": "Firma",
                "email": "login@firma.co",
                "password": "Sifre1234",
            },
        )
        resp = client.post(
            "/api/v1/auth/login", json={"email": "login@firma.co", "password": "yanlis123"}
        )
        assert resp.status_code == 401

    def test_login_and_me(self, client):
        client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": "Firma",
                "email": "me@firma.co",
                "password": "Sifre1234",
            },
        )
        login = client.post(
            "/api/v1/auth/login", json={"email": "me@firma.co", "password": "Sifre1234"}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == "me@firma.co"

    def test_protected_endpoints_require_token(self, client):
        assert client.get("/api/v1/auth/me").status_code == 401
        assert client.get("/api/v1/warehouses").status_code == 401
        assert client.get("/api/v1/products").status_code == 401
        assert client.get("/api/v1/stock/movements").status_code == 401

    def test_invalid_token_rejected(self, client):
        resp = client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert resp.status_code == 401


class TestOrgIsolation:
    def test_org_b_cannot_see_org_a_data(
        self, client, org_factory, user_factory, auth_headers, warehouse_factory, product_factory
    ):
        org_a = org_factory("Org A")
        org_b = org_factory("Org B")
        user_a = user_factory(org_a)
        user_b = user_factory(org_b)
        wh_a = warehouse_factory(org_a, name="A Deposu")
        product_a = product_factory(org_a)

        headers_b = auth_headers(user_b)
        # Lists come back empty, not with A's data.
        assert client.get("/api/v1/warehouses", headers=headers_b).json() == []
        assert client.get("/api/v1/products", headers=headers_b).json()["items"] == []

        # Direct access to A's resources 404s (no existence leak, not 403).
        assert client.get(f"/api/v1/warehouses/{wh_a.id}", headers=headers_b).status_code == 404
        assert client.get(f"/api/v1/products/{product_a.id}", headers=headers_b).status_code == 404
        assert (
            client.get(f"/api/v1/warehouses/{wh_a.id}/layout-3d", headers=headers_b).status_code
            == 404
        )

        # And A still sees its own.
        headers_a = auth_headers(user_a)
        assert client.get(f"/api/v1/warehouses/{wh_a.id}", headers=headers_a).status_code == 200

    def test_org_b_cannot_mutate_org_a_data(
        self, client, org_factory, user_factory, auth_headers, warehouse_factory, product_factory
    ):
        org_a = org_factory("Org A")
        org_b = org_factory("Org B")
        user_b = user_factory(org_b)
        wh_a = warehouse_factory(org_a)
        product_a = product_factory(org_a)
        headers_b = auth_headers(user_b)

        assert (
            client.patch(
                f"/api/v1/warehouses/{wh_a.id}", json={"name": "Ele geçirildi"}, headers=headers_b
            ).status_code
            == 404
        )
        assert (
            client.delete(f"/api/v1/warehouses/{wh_a.id}", headers=headers_b).status_code == 404
        )
        assert (
            client.patch(
                f"/api/v1/products/{product_a.id}", json={"name": "X"}, headers=headers_b
            ).status_code
            == 404
        )

    def test_stock_ops_cannot_cross_orgs(
        self,
        client,
        org_factory,
        user_factory,
        auth_headers,
        warehouse_factory,
        product_factory,
        layout_factory,
    ):
        org_a = org_factory("Org A")
        org_b = org_factory("Org B")
        user_b = user_factory(org_b)
        wh_a = warehouse_factory(org_a)
        product_a = product_factory(org_a)
        _, bins_a = layout_factory(org_a, wh_a)

        resp = client.post(
            "/api/v1/stock/receive",
            json={"product_id": product_a.id, "location_id": bins_a[0].id, "quantity": 5},
            headers=auth_headers(user_b),
        )
        assert resp.status_code == 404

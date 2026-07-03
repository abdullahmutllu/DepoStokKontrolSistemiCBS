from sqlalchemy import select

from app.models import Notification
from app.services import stock_service
from app.services.notification_service import run_low_stock_check


class TestProductsCsv:
    def test_csv_roundtrip(self, client, auth_headers, org_factory, user_factory):
        org = org_factory()
        user = user_factory(org)
        headers = auth_headers(user)

        csv_content = (
            "sku,name,unit,min_stock_threshold\n"
            "CSV-001,Vida M8,adet,50\n"
            "CSV-002,Somun M8,kutu,20\n"
        )
        resp = client.post(
            "/api/v1/products/import-csv",
            files={"file": ("products.csv", csv_content.encode("utf-8"), "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"created": 2, "updated": 0, "errors": []}

        # Re-import updates instead of duplicating; bad row collected as error.
        csv_update = (
            "sku,name,unit,min_stock_threshold\n"
            "CSV-001,Vida M8 Paslanmaz,adet,60\n"
            ",İsimsiz,adet,1\n"
        )
        resp = client.post(
            "/api/v1/products/import-csv",
            files={"file": ("products.csv", csv_update.encode("utf-8"), "text/csv")},
            headers=headers,
        )
        result = resp.json()
        assert result["created"] == 0
        assert result["updated"] == 1
        assert len(result["errors"]) == 1

        export = client.get("/api/v1/products/export-csv", headers=headers)
        assert export.status_code == 200
        assert "CSV-001" in export.text
        assert "Vida M8 Paslanmaz" in export.text

        listing = client.get("/api/v1/products?search=vida", headers=headers).json()
        assert listing["total"] == 1
        assert listing["items"][0]["sku"] == "CSV-001"

    def test_duplicate_sku_conflict(self, client, auth_headers, org_factory, user_factory):
        org = org_factory()
        user = user_factory(org)
        headers = auth_headers(user)
        payload = {"sku": "DUP-1", "name": "Ürün", "unit": "adet"}
        assert client.post("/api/v1/products", json=payload, headers=headers).status_code == 201
        resp = client.post("/api/v1/products", json=payload, headers=headers)
        assert resp.status_code == 409


class TestLowStockNotifications:
    def test_low_stock_check_creates_deduped_notifications(
        self, db, org_factory, user_factory, warehouse_factory, product_factory, layout_factory
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org)
        product = product_factory(org, threshold=10)
        _, bins = layout_factory(org, wh)
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=3,
        )

        created = run_low_stock_check(db)
        assert created == 1
        notif = db.scalar(select(Notification).where(Notification.org_id == org.id))
        assert notif is not None
        assert notif.type == "low_stock"
        assert notif.product_id == product.id
        assert notif.read is False

        # Second run: still unread → no duplicate.
        assert run_low_stock_check(db) == 0

        # After stock replenished above threshold, no new notification either.
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=50,
        )
        notif.read = True
        db.flush()
        assert run_low_stock_check(db) == 0

    def test_low_stock_report_and_unread_count_api(
        self, db, client, auth_headers,
        org_factory, user_factory, warehouse_factory, product_factory, layout_factory,
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org)
        product = product_factory(org, threshold=5)
        _, bins = layout_factory(org, wh)
        headers = auth_headers(user)

        report = client.get("/api/v1/reports/low-stock", headers=headers).json()
        assert [r["product_id"] for r in report] == [product.id]  # zero stock < 5

        resp = client.post("/api/v1/notifications/run-low-stock-check", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["created"] == 1

        unread = client.get("/api/v1/notifications/unread-count", headers=headers).json()
        assert unread["unread"] == 1

        listing = client.get("/api/v1/notifications", headers=headers).json()
        assert listing["total"] == 1
        assert listing["items"][0]["type"] == "low_stock"

        client.post("/api/v1/notifications/mark-all-read", headers=headers)
        unread = client.get("/api/v1/notifications/unread-count", headers=headers).json()
        assert unread["unread"] == 0

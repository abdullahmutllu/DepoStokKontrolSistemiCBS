import pytest
from sqlalchemy import select

from app.core.errors import InsufficientStockError, ValidationFailedError
from app.models import StockItem, StockMovement
from app.services import stock_service


@pytest.fixture
def stock_env(org_factory, user_factory, warehouse_factory, product_factory, layout_factory):
    org = org_factory()
    user = user_factory(org)
    warehouse = warehouse_factory(org)
    product = product_factory(org)
    _, bins = layout_factory(org, warehouse)
    return org, user, warehouse, product, bins


def _qty(db, product_id, location_id) -> int:
    item = db.scalar(
        select(StockItem).where(
            StockItem.product_id == product_id, StockItem.location_id == location_id
        )
    )
    return item.quantity if item else 0


def _movements(db, product_id) -> list[StockMovement]:
    return list(
        db.scalars(
            select(StockMovement)
            .where(StockMovement.product_id == product_id)
            .order_by(StockMovement.id)
        ).all()
    )


class TestReceivePickAdjust:
    def test_receive_creates_item_and_movement(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=30,
        )
        assert _qty(db, product.id, bins[0].id) == 30
        moves = _movements(db, product.id)
        assert len(moves) == 1
        assert moves[0].type == "receive"
        assert moves[0].quantity == 30
        assert moves[0].to_location_id == bins[0].id
        assert moves[0].from_location_id is None
        assert moves[0].user_id == user.id

    def test_receive_accumulates(self, db, stock_env):
        org, user, _, product, bins = stock_env
        for qty in (10, 15):
            stock_service.receive(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                location_id=bins[0].id, quantity=qty,
            )
        assert _qty(db, product.id, bins[0].id) == 25

    def test_pick_decrements_and_audits(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=20,
        )
        stock_service.pick(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=8,
        )
        assert _qty(db, product.id, bins[0].id) == 12
        moves = _movements(db, product.id)
        assert [m.type for m in moves] == ["receive", "pick"]
        assert moves[1].from_location_id == bins[0].id

    def test_pick_more_than_available_rejected(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=5,
        )
        with pytest.raises(InsufficientStockError):
            stock_service.pick(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                location_id=bins[0].id, quantity=6,
            )
        assert _qty(db, product.id, bins[0].id) == 5
        assert len(_movements(db, product.id)) == 1  # no pick movement written

    def test_pick_from_empty_bin_rejected(self, db, stock_env):
        org, user, _, product, bins = stock_env
        with pytest.raises(InsufficientStockError):
            stock_service.pick(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                location_id=bins[0].id, quantity=1,
            )

    def test_adjust_sets_value_and_records_delta(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=10,
        )
        stock_service.adjust(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, new_quantity=4,
        )
        assert _qty(db, product.id, bins[0].id) == 4
        moves = _movements(db, product.id)
        assert moves[-1].type == "adjust"
        assert moves[-1].quantity == 6  # |4 - 10|

    def test_adjust_negative_rejected(self, db, stock_env):
        org, user, _, product, bins = stock_env
        with pytest.raises(ValidationFailedError):
            stock_service.adjust(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                location_id=bins[0].id, new_quantity=-1,
            )


class TestTransfer:
    def test_transfer_moves_stock_atomically(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=50,
        )
        stock_service.transfer(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            from_location_id=bins[0].id, to_location_id=bins[1].id, quantity=20,
        )
        assert _qty(db, product.id, bins[0].id) == 30
        assert _qty(db, product.id, bins[1].id) == 20
        moves = _movements(db, product.id)
        assert moves[-1].type == "transfer"
        assert moves[-1].from_location_id == bins[0].id
        assert moves[-1].to_location_id == bins[1].id

    def test_transfer_insufficient_rejected(self, db, stock_env):
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=5,
        )
        with pytest.raises(InsufficientStockError):
            stock_service.transfer(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                from_location_id=bins[0].id, to_location_id=bins[1].id, quantity=10,
            )
        assert _qty(db, product.id, bins[0].id) == 5
        assert _qty(db, product.id, bins[1].id) == 0

    def test_transfer_same_bin_rejected(self, db, stock_env):
        org, user, _, product, bins = stock_env
        with pytest.raises(ValidationFailedError):
            stock_service.transfer(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                from_location_id=bins[0].id, to_location_id=bins[0].id, quantity=1,
            )

    def test_transfer_atomicity_on_midway_failure(self, db, stock_env, monkeypatch):
        """If anything fails between debit and credit, NOTHING must persist."""
        org, user, _, product, bins = stock_env
        stock_service.receive(
            db, org_id=org.id, user_id=user.id, product_id=product.id,
            location_id=bins[0].id, quantity=40,
        )
        db.commit()  # the receive was its own successful request
        movement_count_before = len(_movements(db, product.id))

        def boom():
            raise RuntimeError("simulated crash between debit and credit")

        monkeypatch.setattr(stock_service, "_after_debit", boom)
        with pytest.raises(RuntimeError):
            stock_service.transfer(
                db, org_id=org.id, user_id=user.id, product_id=product.id,
                from_location_id=bins[0].id, to_location_id=bins[1].id, quantity=10,
            )
        db.rollback()  # what the request boundary does on error

        assert _qty(db, product.id, bins[0].id) == 40  # debit rolled back
        assert _qty(db, product.id, bins[1].id) == 0  # credit never applied
        assert len(_movements(db, product.id)) == movement_count_before  # no audit row


class TestStockApi:
    def test_receive_transfer_pick_flow_via_api(self, client, auth_headers, stock_env):
        org, user, _, product, bins = stock_env
        headers = auth_headers(user)

        r = client.post(
            "/api/v1/stock/receive",
            json={"product_id": product.id, "location_id": bins[0].id, "quantity": 12},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["quantity"] == 12

        r = client.post(
            "/api/v1/stock/transfer",
            json={
                "product_id": product.id,
                "from_location_id": bins[0].id,
                "to_location_id": bins[1].id,
                "quantity": 5,
            },
            headers=headers,
        )
        assert r.status_code == 200

        r = client.post(
            "/api/v1/stock/pick",
            json={"product_id": product.id, "location_id": bins[1].id, "quantity": 99},
            headers=headers,
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "INSUFFICIENT_STOCK"

        moves = client.get("/api/v1/stock/movements", headers=headers).json()
        assert moves["total"] == 2
        assert {m["type"] for m in moves["items"]} == {"receive", "transfer"}

    def test_zero_or_negative_quantity_rejected_by_validation(
        self, client, auth_headers, stock_env
    ):
        org, user, _, product, bins = stock_env
        headers = auth_headers(user)
        for qty in (0, -3):
            r = client.post(
                "/api/v1/stock/receive",
                json={"product_id": product.id, "location_id": bins[0].id, "quantity": qty},
                headers=headers,
            )
            assert r.status_code == 422

    def test_find_product_returns_locations(self, client, auth_headers, stock_env):
        org, user, _, product, bins = stock_env
        headers = auth_headers(user)
        client.post(
            "/api/v1/stock/receive",
            json={"product_id": product.id, "location_id": bins[2].id, "quantity": 7},
            headers=headers,
        )
        r = client.get(f"/api/v1/stock/find-product?q={product.sku}", headers=headers)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["location_id"] == bins[2].id
        assert rows[0]["quantity"] == 7

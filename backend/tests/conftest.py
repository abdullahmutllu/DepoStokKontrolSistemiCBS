import os

# Must happen before any app import: point the app at the test DB, kill the scheduler.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/depo_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["RUN_SCHEDULER"] = "0"
os.environ["OPENROUTER_API_KEY"] = ""  # AI must be explicitly mocked in tests

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models import Base, Organization, Product, User, Warehouse
from app.schemas.location import LayoutGenerateRequest, RackPlacement
from app.schemas.warehouse import LatLng
from app.services import geo, layout_builder


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    """Canonical SQLAlchemy 2.0 transactional test recipe: everything a test
    (and the app code it drives) does lands on savepoints inside one outer
    transaction that is rolled back at teardown."""
    conn = engine.connect()
    trans = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        conn.close()


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ---------- factories ----------


@pytest.fixture
def org_factory(db):
    def make(name: str = "Test Org") -> Organization:
        org = Organization(name=name)
        db.add(org)
        db.commit()  # savepoint-level: keeps fixtures stable across request rollbacks
        return org

    return make


@pytest.fixture
def user_factory(db):
    counter = {"n": 0}

    def make(org: Organization, role: str = "owner", password: str = "Test12345") -> User:
        counter["n"] += 1
        user = User(
            org_id=org.id,
            email=f"user{counter['n']}-{org.id}@test.co",
            password_hash=hash_password(password),
            role=role,
        )
        db.add(user)
        db.commit()
        return user

    return make


@pytest.fixture
def auth_headers():
    def make(user: User) -> dict[str, str]:
        token = create_access_token(user.id, user.org_id, user.role)
        return {"Authorization": f"Bearer {token}"}

    return make


@pytest.fixture
def warehouse_factory(db):
    def make(
        org: Organization,
        name: str = "Depo",
        width: float = 40,
        depth: float = 25,
        lat: float = 39.92,
        lng: float = 32.85,
    ) -> Warehouse:
        wh = Warehouse(
            org_id=org.id,
            name=name,
            address=None,
            location=geo.latlng_to_point(LatLng(lat=lat, lng=lng)),
            local_width=width,
            local_depth=depth,
        )
        db.add(wh)
        db.commit()
        return wh

    return make


@pytest.fixture
def product_factory(db):
    counter = {"n": 0}

    def make(org: Organization, sku: str | None = None, threshold: int = 0) -> Product:
        counter["n"] += 1
        product = Product(
            org_id=org.id,
            sku=sku or f"SKU-{org.id}-{counter['n']:03d}",
            name=f"Ürün {counter['n']}",
            unit="adet",
            min_stock_threshold=threshold,
        )
        db.add(product)
        db.commit()
        return product

    return make


@pytest.fixture
def layout_factory(db):
    """Generates a small rack layout and returns the created bin locations."""

    def make(
        org: Organization, warehouse: Warehouse, racks: int = 1, shelves: int = 2, bins: int = 3
    ):
        placements = [
            RackPlacement(
                col=2,
                row=2 + i * 6,
                w_cells=6,
                d_cells=2,
                shelf_count=shelves,
                bins_per_shelf=bins,
                shelf_height=1.5,
                bin_capacity=100,
            )
            for i in range(racks)
        ]
        result = layout_builder.generate_layout(
            db,
            org.id,
            warehouse.id,
            LayoutGenerateRequest(cell_size=0.5, racks=placements),
        )
        db.commit()
        from sqlalchemy import select

        from app.models import StorageLocation

        bin_locs = (
            db.scalars(
                select(StorageLocation).where(
                    StorageLocation.warehouse_id == warehouse.id,
                    StorageLocation.type == "bin",
                )
            )
            .unique()
            .all()
        )
        return result, list(bin_locs)

    return make

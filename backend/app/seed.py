"""Idempotent demo seed: `python -m app.seed`.

Creates a demo org (owner@demo.co / Demo1234!), two warehouses with map
locations, builder-generated rack layouts, ~30 products and a stock spread
that exercises the whole occupancy scale (empty/green/amber/red) plus a few
below-threshold products so low-stock reporting has data.
"""

import random

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import Organization, Product, StorageLocation, User, Warehouse
from app.schemas.location import LayoutGenerateRequest, RackPlacement
from app.schemas.warehouse import LatLng
from app.services import geo, layout_builder, stock_service

DEMO_EMAIL = "owner@demo.co"
DEMO_PASSWORD = "Demo1234!"

PRODUCT_CATALOG = [
    ("VDA-M6-020", "Vida M6x20 İmbus", "kutu", 40),
    ("VDA-M8-030", "Vida M8x30 İmbus", "kutu", 40),
    ("SMN-M6", "Somun M6 Paslanmaz", "kutu", 30),
    ("SMN-M8", "Somun M8 Paslanmaz", "kutu", 30),
    ("PUL-M8", "Pul M8 Geniş", "kutu", 20),
    ("RLM-6204", "Rulman 6204 2RS", "adet", 25),
    ("RLM-6305", "Rulman 6305 ZZ", "adet", 25),
    ("KYS-V13", "V Kayışı 13x1250", "adet", 15),
    ("KYS-V17", "V Kayışı 17x1600", "adet", 15),
    ("HRT-25", "Hidrolik Hortum 1/4\"", "metre", 50),
    ("HRT-38", "Hidrolik Hortum 3/8\"", "metre", 50),
    ("FLT-Y100", "Yağ Filtresi Y-100", "adet", 30),
    ("FLT-H200", "Hava Filtresi H-200", "adet", 30),
    ("CNT-2P", "Kontaktör 2P 25A", "adet", 10),
    ("CNT-3P", "Kontaktör 3P 40A", "adet", 10),
    ("SGR-C16", "Sigorta C16 Otomat", "adet", 40),
    ("SGR-C25", "Sigorta C25 Otomat", "adet", 40),
    ("KBL-3X15", "Kablo 3x1.5 TTR", "metre", 100),
    ("KBL-5X25", "Kablo 5x2.5 NYY", "metre", 100),
    ("BNT-IZO", "İzole Bant Siyah", "adet", 60),
    ("ELD-NIT-L", "Nitril Eldiven L", "paket", 25),
    ("ELD-NIT-XL", "Nitril Eldiven XL", "paket", 25),
    ("GZL-KOR", "Koruyucu Gözlük", "adet", 20),
    ("MSK-FFP2", "Toz Maskesi FFP2", "paket", 30),
    ("YAG-HID46", "Hidrolik Yağ 46 (20L)", "bidon", 12),
    ("YAG-GRES", "Gres Yağı (5kg)", "kova", 10),
    ("SPR-WD40", "WD-40 Sprey 400ml", "adet", 35),
    ("KGT-A4", "Fotokopi Kağıdı A4", "koli", 8),
    ("ETK-TERM", "Termal Etiket 100x150", "rulo", 45),
    ("PLT-EUR", "Euro Palet 80x120", "adet", 20),
]


# Türkiye geneli talep noktaları (il merkezleri, ağırlık ≈ göreli pazar büyüklüğü) —
# ağ analizi demoları için (ısı haritası, ağırlık merkezi, en yakın depo ataması).
CUSTOMER_POINTS: list[tuple[str, float, float, int]] = [
    ("İstanbul", 41.01, 28.98, 25), ("Ankara", 39.93, 32.86, 18), ("İzmir", 38.42, 27.14, 15),
    ("Bursa", 40.19, 29.06, 10), ("Antalya", 36.90, 30.71, 9), ("Adana", 37.00, 35.32, 8),
    ("Konya", 37.87, 32.49, 7), ("Gaziantep", 37.07, 37.38, 7), ("Kocaeli", 40.85, 29.88, 6),
    ("Mersin", 36.80, 34.63, 5), ("Diyarbakır", 37.91, 40.24, 5), ("Kayseri", 38.72, 35.49, 5),
    ("Samsun", 41.29, 36.33, 5), ("Şanlıurfa", 37.16, 38.79, 4), ("Trabzon", 41.00, 39.72, 4),
    ("Eskişehir", 39.78, 30.52, 4), ("Denizli", 37.78, 29.09, 3), ("Malatya", 38.35, 38.31, 3),
    ("Erzurum", 39.90, 41.27, 3), ("Van", 38.49, 43.38, 3), ("Tekirdağ", 40.98, 27.51, 3),
    ("Balıkesir", 39.65, 27.89, 3), ("Manisa", 38.61, 27.43, 3), ("Sakarya", 40.76, 30.38, 3),
    ("Hatay", 36.20, 36.16, 3), ("Kahramanmaraş", 37.58, 36.93, 3), ("Aydın", 37.85, 27.85, 2),
    ("Muğla", 37.22, 28.36, 2), ("Çorum", 40.55, 34.95, 2), ("Sivas", 39.75, 37.02, 2),
    ("Ordu", 40.98, 37.88, 2), ("Afyonkarahisar", 38.76, 30.54, 2), ("Batman", 37.88, 41.13, 2),
    ("Mardin", 37.31, 40.74, 2), ("Elazığ", 38.68, 39.22, 2), ("Rize", 41.02, 40.52, 1),
    ("Kastamonu", 41.38, 33.78, 1), ("Isparta", 37.77, 30.55, 1), ("Tokat", 40.31, 36.55, 1),
    ("Zonguldak", 41.45, 31.79, 1), ("Edirne", 41.68, 26.56, 1), ("Çanakkale", 40.15, 26.41, 1),
    ("Kütahya", 39.42, 29.98, 1), ("Uşak", 38.68, 29.40, 1), ("Niğde", 37.97, 34.68, 1),
    ("Aksaray", 38.37, 34.03, 1), ("Karaman", 37.18, 33.22, 1), ("Kırıkkale", 39.84, 33.51, 1),
    ("Yozgat", 39.82, 34.81, 1), ("Amasya", 40.65, 35.83, 1), ("Giresun", 40.91, 38.39, 1),
    ("Erzincan", 39.75, 39.49, 1), ("Ağrı", 39.72, 43.05, 1), ("Muş", 38.73, 41.49, 1),
    ("Bitlis", 38.40, 42.11, 1), ("Siirt", 37.93, 41.94, 1), ("Adıyaman", 37.76, 38.28, 1),
    ("Osmaniye", 37.07, 36.25, 1), ("Düzce", 40.84, 31.16, 1), ("Bolu", 40.74, 31.61, 1),
]


def _seed_customers(db, org_id: int) -> int:
    """Adds Turkey-wide demand points if missing (idempotent by name)."""
    from app.models import Customer

    existing = set(
        db.scalars(select(Customer.name).where(Customer.org_id == org_id)).all()
    )
    created = 0
    for city, lat, lng, weight in CUSTOMER_POINTS:
        name = f"{city} Bayi"
        if name in existing:
            continue
        db.add(
            Customer(
                org_id=org_id,
                name=name,
                location=geo.latlng_to_point(LatLng(lat=lat, lng=lng)),
                weight=weight,
                city=city,
            )
        )
        created += 1
    db.flush()
    return created


# Ankara çevresi ek demo depoları — bölgesel raporlama (İç Anadolu) demoları için.
EXTRA_WAREHOUSES = [
    {
        "name": "Sincan OSB Deposu",
        "address": "Sincan OSB, Sincan/Ankara",
        "latlng": LatLng(lat=39.9740, lng=32.5690),
        "width": 30.0,
        "depth": 20.0,
        "racks": [
            RackPlacement(col=3, row=3, w_cells=12, d_cells=2, shelf_count=3,
                          bins_per_shelf=6, shelf_height=1.5, bin_capacity=90),
            RackPlacement(col=3, row=12, w_cells=12, d_cells=2, shelf_count=3,
                          bins_per_shelf=6, shelf_height=1.5, bin_capacity=90),
        ],
        "fill": 0.5,
    },
    {
        "name": "Gölbaşı Dağıtım Merkezi",
        "address": "Gölbaşı, Ankara",
        "latlng": LatLng(lat=39.7900, lng=32.8080),
        "width": 25.0,
        "depth": 18.0,
        "racks": [
            RackPlacement(col=2, row=3, w_cells=14, d_cells=2, shelf_count=4,
                          bins_per_shelf=7, shelf_height=1.4, bin_capacity=60),
        ],
        "fill": 0.75,
    },
    {
        "name": "Kahramankazan Deposu",
        "address": "Kahramankazan, Ankara",
        "latlng": LatLng(lat=40.2340, lng=32.6850),
        "width": 20.0,
        "depth": 15.0,
        "racks": [
            RackPlacement(col=2, row=2, w_cells=10, d_cells=2, shelf_count=2,
                          bins_per_shelf=5, shelf_height=1.8, bin_capacity=120),
        ],
        "fill": 0.3,
    },
    {
        "name": "Polatlı Lojistik Deposu",
        "address": "Polatlı, Ankara",
        "latlng": LatLng(lat=39.5840, lng=32.1470),
        "width": 35.0,
        "depth": 22.0,
        "racks": [
            RackPlacement(col=3, row=4, w_cells=16, d_cells=2, shelf_count=3,
                          bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
            RackPlacement(col=3, row=14, w_cells=16, d_cells=2, shelf_count=3,
                          bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
        ],
        "fill": 0.85,
    },
]


def _seed_extra_warehouses(db, org_id: int, user_id: int) -> int:
    """Adds the Ankara demo warehouses if missing (idempotent by name)."""
    from app.models import StorageLocation

    rng = random.Random(7)
    products = list(
        db.scalars(select(Product).where(Product.org_id == org_id).order_by(Product.id)).all()
    )
    created = 0
    for wd in EXTRA_WAREHOUSES:
        exists = db.scalar(
            select(Warehouse).where(Warehouse.org_id == org_id, Warehouse.name == wd["name"])
        )
        if exists is not None:
            continue
        wh = Warehouse(
            org_id=org_id,
            name=wd["name"],
            address=wd["address"],
            location=geo.latlng_to_point(wd["latlng"]),
            footprint=geo.footprint_polygon(wd["latlng"], wd["width"], wd["depth"]),
            local_width=wd["width"],
            local_depth=wd["depth"],
        )
        db.add(wh)
        db.flush()
        layout_builder.generate_layout(
            db, org_id, wh.id,
            LayoutGenerateRequest(cell_size=0.5, racks=wd["racks"], zone_label="Ana Zon"),
        )
        bins = list(
            db.scalars(
                select(StorageLocation).where(
                    StorageLocation.warehouse_id == wh.id, StorageLocation.type == "bin"
                )
            ).all()
        )
        rng.shuffle(bins)
        if products:
            # Fill a share of bins with a green/amber/red spread around wd["fill"].
            for target in bins[: max(1, int(len(bins) * wd["fill"] * 0.6))]:
                product = rng.choice(products)
                capacity = target.capacity or 100
                ratio = min(1.0, max(0.1, rng.gauss(wd["fill"], 0.25)))
                stock_service.receive(
                    db, org_id=org_id, user_id=user_id, product_id=product.id,
                    location_id=target.id, quantity=max(1, int(capacity * ratio)),
                    note="Açılış stoğu",
                )
        created += 1
    db.flush()
    return created


def _seed_orders(db, org_id: int) -> int:
    """Dalga toplama demosu için açık siparişler (isimle idempotent)."""
    from app.models import Order, OrderLine, Product, Warehouse

    if db.scalar(select(Order).where(Order.org_id == org_id)) is not None:
        return 0
    warehouse = db.scalar(
        select(Warehouse).where(Warehouse.org_id == org_id).order_by(Warehouse.id)
    )
    products = list(
        db.scalars(select(Product).where(Product.org_id == org_id).order_by(Product.id)).all()
    )
    if warehouse is None or len(products) < 6:
        return 0
    specs = [
        ("Aslan Market", [(0, 12), (2, 4)]),
        ("Yıldız İnşaat", [(1, 8), (3, 2), (5, 6)]),
        ("Kaya Otomotiv", [(2, 10), (4, 3)]),
        ("Demir Tarım", [(0, 5), (5, 9)]),
    ]
    created = 0
    for customer_name, lines in specs:
        order = Order(
            org_id=org_id, warehouse_id=warehouse.id, code="", customer_name=customer_name
        )
        db.add(order)
        db.flush()
        order.code = f"SIP-{order.id:04d}"
        for product_idx, qty in lines:
            db.add(
                OrderLine(
                    order_id=order.id, product_id=products[product_idx].id, quantity=qty
                )
            )
        created += 1
    db.flush()
    return created


def seed() -> None:
    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if existing is not None:
            created = _seed_extra_warehouses(db, existing.org_id, existing.id)
            created_customers = _seed_customers(db, existing.org_id)
            created_orders = _seed_orders(db, existing.org_id)
            db.commit()
            if created or created_customers or created_orders:
                print(
                    f"Temel seed mevcut; {created} ek depo, "
                    f"{created_customers} müşteri noktası, "
                    f"{created_orders} sipariş eklendi."
                )
            else:
                print(f"Seed zaten mevcut ({DEMO_EMAIL}); atlanıyor.")
            return

        rng = random.Random(42)

        org = Organization(name="Demo Lojistik A.Ş.")
        db.add(org)
        db.flush()
        owner = User(
            org_id=org.id,
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            role="owner",
        )
        staff = User(
            org_id=org.id,
            email="staff@demo.co",
            password_hash=hash_password(DEMO_PASSWORD),
            role="staff",
        )
        db.add_all([owner, staff])
        db.flush()

        wh_defs = [
            {
                "name": "İstanbul Ana Depo",
                "address": "İkitelli OSB, Başakşehir/İstanbul",
                "latlng": LatLng(lat=41.0655, lng=28.7906),
                "width": 40.0,
                "depth": 25.0,
                "racks": [
                    # Two back-to-back rack rows per aisle band, 3 aisles
                    RackPlacement(col=4, row=4, w_cells=16, d_cells=2, shelf_count=4,
                                  bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
                    RackPlacement(col=24, row=4, w_cells=16, d_cells=2, shelf_count=4,
                                  bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
                    RackPlacement(col=4, row=16, w_cells=16, d_cells=2, shelf_count=4,
                                  bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
                    RackPlacement(col=24, row=16, w_cells=16, d_cells=2, shelf_count=4,
                                  bins_per_shelf=8, shelf_height=1.5, bin_capacity=100),
                    RackPlacement(col=4, row=28, w_cells=36, d_cells=2, shelf_count=3,
                                  bins_per_shelf=12, shelf_height=1.8, bin_capacity=150),
                ],
            },
            {
                "name": "Ankara Bölge Deposu",
                "address": "OSTİM OSB, Yenimahalle/Ankara",
                "latlng": LatLng(lat=39.9698, lng=32.7568),
                "width": 25.0,
                "depth": 18.0,
                "racks": [
                    RackPlacement(col=3, row=3, w_cells=14, d_cells=2, shelf_count=3,
                                  bins_per_shelf=6, shelf_height=1.5, bin_capacity=80),
                    RackPlacement(col=3, row=12, w_cells=14, d_cells=2, shelf_count=3,
                                  bins_per_shelf=6, shelf_height=1.5, bin_capacity=80),
                    RackPlacement(col=3, row=21, w_cells=20, d_cells=2, shelf_count=2,
                                  bins_per_shelf=8, shelf_height=2.0, bin_capacity=120),
                ],
            },
        ]

        warehouses: list[Warehouse] = []
        for wd in wh_defs:
            wh = Warehouse(
                org_id=org.id,
                name=wd["name"],
                address=wd["address"],
                location=geo.latlng_to_point(wd["latlng"]),
                footprint=geo.footprint_polygon(wd["latlng"], wd["width"], wd["depth"]),
                local_width=wd["width"],
                local_depth=wd["depth"],
            )
            db.add(wh)
            db.flush()
            layout_builder.generate_layout(
                db, org.id, wh.id,
                LayoutGenerateRequest(cell_size=0.5, racks=wd["racks"], zone_label="Ana Zon"),
            )
            warehouses.append(wh)

        products = [
            Product(org_id=org.id, sku=sku, name=name, unit=unit, min_stock_threshold=threshold)
            for sku, name, unit, threshold in PRODUCT_CATALOG
        ]
        db.add_all(products)
        db.flush()

        bins = list(
            db.scalars(
                select(StorageLocation).where(
                    StorageLocation.warehouse_id.in_([w.id for w in warehouses]),
                    StorageLocation.type == "bin",
                )
            ).all()
        )
        rng.shuffle(bins)

        # Occupancy spread: ~15% red (>85%), ~20% amber (60-85%), ~35% green,
        # rest empty. Low-stock products (last 4) get almost nothing.
        low_stock_products = products[-4:]
        normal_products = products[:-4]
        bin_cursor = 0

        def next_bin() -> StorageLocation:
            nonlocal bin_cursor
            b = bins[bin_cursor % len(bins)]
            bin_cursor += 1
            return b

        for product in normal_products:
            for _ in range(rng.randint(1, 3)):
                target = next_bin()
                capacity = target.capacity or 100
                bucket = rng.random()
                if bucket < 0.15:
                    fill = rng.uniform(0.88, 1.0)  # red
                elif bucket < 0.35:
                    fill = rng.uniform(0.62, 0.84)  # amber
                elif bucket < 0.75:
                    fill = rng.uniform(0.15, 0.55)  # green
                else:
                    continue  # leave empty
                qty = max(1, int(capacity * fill))
                stock_service.receive(
                    db, org_id=org.id, user_id=owner.id, product_id=product.id,
                    location_id=target.id, quantity=qty, note="Açılış stoğu",
                )

        for product in low_stock_products:
            target = next_bin()
            qty = max(1, product.min_stock_threshold // 4)
            stock_service.receive(
                db, org_id=org.id, user_id=owner.id, product_id=product.id,
                location_id=target.id, quantity=qty, note="Açılış stoğu (düşük)",
            )

        # A few picks/transfers so movement history isn't empty.
        from app.models import StockItem

        for product in normal_products[:8]:
            items = db.scalars(
                select(StockItem).where(
                    StockItem.product_id == product.id, StockItem.quantity > 3
                )
            ).all()
            if not items:
                continue
            item = items[0]
            pick_qty = max(1, item.quantity // 5)
            stock_service.pick(
                db, org_id=org.id, user_id=staff.id, product_id=product.id,
                location_id=item.location_id, quantity=pick_qty, note="Sipariş sevkiyatı",
            )
            if len(items) > 1:
                stock_service.transfer(
                    db, org_id=org.id, user_id=staff.id, product_id=product.id,
                    from_location_id=items[0].location_id,
                    to_location_id=items[1].location_id,
                    quantity=1, note="Konsolidasyon",
                )

        extra = _seed_extra_warehouses(db, org.id, owner.id)
        _seed_customers(db, org.id)
        _seed_orders(db, org.id)

        db.commit()
        bin_count = len(bins)
        print(
            f"Seed tamam: org='{org.name}', kullanıcılar: {DEMO_EMAIL} / staff@demo.co "
            f"(şifre: {DEMO_PASSWORD}), {len(warehouses) + extra} depo, {bin_count} göz, "
            f"{len(products)} ürün."
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()

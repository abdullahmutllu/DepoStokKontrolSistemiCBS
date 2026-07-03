"""Region analysis over PostGIS. All geography/geometry casts live here.

Every query is anchored to org_id before spatial filters apply — a polygon can
never widen access beyond the caller's organization.
"""

from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session, aliased

from app.models import Product, StockItem, StorageLocation, Warehouse
from app.schemas.geo import RegionAnalysisOut, RegionRing, RegionWarehouseRow
from app.schemas.warehouse import LatLng
from app.services import geo, report_service


def warehouses_in_ring(db: Session, org_id: int, ring: list[LatLng]) -> list[Warehouse]:
    poly = geo.ring_to_polygon(ring)
    return list(
        db.scalars(
            select(Warehouse)
            .where(
                Warehouse.org_id == org_id,
                func.ST_Covers(cast(poly, Geography), Warehouse.location),
            )
            .order_by(Warehouse.id)
        ).all()
    )


def region_analysis(db: Session, org_id: int, payload: RegionRing) -> RegionAnalysisOut:
    poly = geo.ring_to_polygon(payload.ring)

    area_m2 = float(db.scalar(select(func.ST_Area(cast(poly, Geography)))) or 0.0)
    centroid_wkb = db.scalar(
        select(func.ST_Centroid(cast(poly, Geometry(srid=4326))))
    )
    centroid = geo.point_to_latlng(centroid_wkb) or payload.ring[0]
    centroid_geog = cast(
        func.ST_SetSRID(func.ST_MakePoint(centroid.lng, centroid.lat), 4326), Geography
    )

    warehouses = warehouses_in_ring(db, org_id, payload.ring)
    warehouse_ids = [w.id for w in warehouses]

    summaries = {
        s.warehouse_id: s
        for s in report_service.warehouse_summaries(db, org_id, warehouse_ids=warehouse_ids)
    }

    distances: dict[int, float] = {}
    if warehouse_ids:
        rows = db.execute(
            select(
                Warehouse.id,
                func.ST_Distance(Warehouse.location, centroid_geog).label("dist"),
            ).where(Warehouse.id.in_(warehouse_ids))
        ).all()
        distances = {r.id: float(r.dist) for r in rows}

    max_pairwise = 0.0
    if len(warehouse_ids) >= 2:
        a, b = aliased(Warehouse), aliased(Warehouse)
        max_pairwise = float(
            db.scalar(
                select(func.max(func.ST_Distance(a.location, b.location))).where(
                    a.id.in_(warehouse_ids), b.id.in_(warehouse_ids), a.id < b.id
                )
            )
            or 0.0
        )

    # Total capacity across region bins (for the weighted occupancy figure).
    total_capacity = 0
    if warehouse_ids:
        total_capacity = int(
            db.scalar(
                select(func.coalesce(func.sum(StorageLocation.capacity), 0)).where(
                    StorageLocation.warehouse_id.in_(warehouse_ids),
                    StorageLocation.type == "bin",
                )
            )
            or 0
        )

    # Org-wide low-stock products that physically sit in this region.
    low_stock_count = 0
    if warehouse_ids:
        low_rows = report_service.low_stock(db, org_id)
        low_ids = {r.product_id for r in low_rows}
        if low_ids:
            in_region = set(
                db.scalars(
                    select(func.distinct(StockItem.product_id))
                    .join(StorageLocation, StockItem.location_id == StorageLocation.id)
                    .join(Product, StockItem.product_id == Product.id)
                    .where(
                        StorageLocation.warehouse_id.in_(warehouse_ids),
                        Product.org_id == org_id,
                        StockItem.quantity > 0,
                    )
                ).all()
            )
            low_stock_count = len(low_ids & in_region)

    rows_out: list[RegionWarehouseRow] = []
    total_quantity = total_bins = used_bins = 0
    for wh in warehouses:
        s = summaries.get(wh.id)
        if s is None:
            continue
        total_quantity += s.total_quantity
        total_bins += s.bin_count
        used_bins += s.used_bin_count
        rows_out.append(
            RegionWarehouseRow(
                warehouse_id=wh.id,
                warehouse_name=wh.name,
                address=wh.address,
                location=geo.point_to_latlng(wh.location) or centroid,
                zone_count=s.zone_count,
                rack_count=s.rack_count,
                bin_count=s.bin_count,
                used_bin_count=s.used_bin_count,
                total_quantity=s.total_quantity,
                occupancy_percent=s.occupancy_percent,
                distance_to_centroid_m=round(distances.get(wh.id, 0.0), 1),
            )
        )

    return RegionAnalysisOut(
        area_m2=round(area_m2, 1),
        centroid=centroid,
        warehouse_count=len(rows_out),
        total_quantity=total_quantity,
        total_bins=total_bins,
        used_bins=used_bins,
        occupancy_percent=round(total_quantity / total_capacity * 100, 1)
        if total_capacity
        else 0.0,
        low_stock_product_count=low_stock_count,
        max_pairwise_distance_m=round(max_pairwise, 1),
        warehouses=rows_out,
    )

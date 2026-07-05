"""Supply-network analyses over demand points (customers) and warehouses.

Design notes:
- Distances between the ~60 demand points and a handful of warehouses are
  computed with a Python haversine — deterministic, unit-testable, and cheaper
  than round-tripping PostGIS for point-to-point math.
- PostGIS is used where it genuinely wins: Voronoi territories
  (ST_VoronoiPolygons) and coverage rings (ST_Buffer on geography).
- Center-of-gravity (greenfield) uses a deterministic weighted k-means
  (heaviest distinct points as initial centers, fixed iteration order) so
  results and tests are reproducible without a random seed.
"""

import json
from dataclasses import dataclass

from geoalchemy2 import Geography
from sqlalchemy import cast, func, select, text
from sqlalchemy.orm import Session, aliased

from app.core.errors import ValidationFailedError
from app.models import Customer, StockMovement, StorageLocation, Warehouse
from app.schemas.network import (
    AssignmentLine,
    CenterOfGravityOut,
    ClosestFacilityOut,
    CoverageBand,
    CoverageOut,
    DemandPoint,
    FacilityLoad,
    FlowArc,
    FlowMapOut,
    ProposedSite,
    WarehouseCoverage,
)
from app.schemas.warehouse import LatLng
from app.services import geo, ors

RING_KM = [10.0, 25.0, 50.0]


@dataclass
class _Point:
    id: int
    name: str
    loc: LatLng
    weight: int


def _customers(db: Session, org_id: int) -> list[_Point]:
    rows = db.scalars(
        select(Customer).where(Customer.org_id == org_id).order_by(Customer.id)
    ).all()
    return [
        _Point(id=c.id, name=c.name, loc=geo.point_to_latlng(c.location), weight=c.weight)
        for c in rows
    ]


def _warehouses(db: Session, org_id: int) -> list[_Point]:
    rows = db.scalars(
        select(Warehouse).where(Warehouse.org_id == org_id).order_by(Warehouse.id)
    ).all()
    return [
        _Point(id=w.id, name=w.name, loc=geo.point_to_latlng(w.location), weight=0)
        for w in rows
    ]


def demand_points(db: Session, org_id: int) -> list[DemandPoint]:
    return [
        DemandPoint(id=p.id, name=p.name, location=p.loc, weight=p.weight)
        for p in _customers(db, org_id)
    ]


# ── Center of gravity (greenfield) ───────────────────────────────────────────


def _weighted_kmeans(points: list[_Point], n: int, iterations: int = 40) -> list[LatLng]:
    """Deterministic weighted Lloyd's algorithm. Initial centers = the n
    heaviest points (distinct locations), so runs are reproducible."""
    seeds: list[LatLng] = []
    for p in sorted(points, key=lambda p: (-p.weight, p.id)):
        if all(geo.haversine_km(p.loc, s) > 1e-6 for s in seeds):
            seeds.append(LatLng(lat=p.loc.lat, lng=p.loc.lng))
        if len(seeds) == n:
            break
    if not seeds:
        raise ValidationFailedError("Analiz için geçerli müşteri noktası bulunamadı")
    centers = seeds

    for _ in range(iterations):
        buckets: list[list[_Point]] = [[] for _ in centers]
        for p in points:
            best = min(range(len(centers)), key=lambda i: geo.haversine_km(p.loc, centers[i]))
            buckets[best].append(p)
        moved = 0.0
        new_centers: list[LatLng] = []
        for i, bucket in enumerate(buckets):
            if not bucket:
                new_centers.append(centers[i])
                continue
            total_w = sum(p.weight for p in bucket)
            lat = sum(p.loc.lat * p.weight for p in bucket) / total_w
            lng = sum(p.loc.lng * p.weight for p in bucket) / total_w
            candidate = LatLng(lat=lat, lng=lng)
            moved = max(moved, geo.haversine_km(centers[i], candidate))
            new_centers.append(candidate)
        centers = new_centers
        if moved < 0.01:  # <10 m — converged
            break
    return centers


def _total_weighted_km(points: list[_Point], sites: list[LatLng]) -> float:
    total = 0.0
    for p in points:
        total += p.weight * min(geo.haversine_km(p.loc, s) for s in sites)
    return total


def center_of_gravity(db: Session, org_id: int, n_sites: int) -> CenterOfGravityOut:
    customers = _customers(db, org_id)
    if len(customers) < max(2, n_sites):
        raise ValidationFailedError(
            "Ağırlık merkezi analizi için yeterli müşteri noktası yok "
            "(önce müşteri ekleyin veya CSV içe aktarın)"
        )
    warehouses = _warehouses(db, org_id)

    centers = _weighted_kmeans(customers, n_sites)

    assignments: list[AssignmentLine] = []
    site_stats = [{"count": 0, "weight": 0} for _ in centers]
    for p in customers:
        best = min(range(len(centers)), key=lambda i: geo.haversine_km(p.loc, centers[i]))
        distance_km = geo.haversine_km(p.loc, centers[best])
        site_stats[best]["count"] += 1
        site_stats[best]["weight"] += p.weight
        assignments.append(
            AssignmentLine(
                customer_id=p.id,
                from_location=p.loc,
                to_location=centers[best],
                weight=p.weight,
                distance_m=round(distance_km * 1000, 1),
            )
        )

    current = (
        _total_weighted_km(customers, [w.loc for w in warehouses]) if warehouses else 0.0
    )
    proposed = _total_weighted_km(customers, centers)
    improvement = ((current - proposed) / current * 100) if current > 0 else 0.0

    return CenterOfGravityOut(
        n_sites=n_sites,
        proposed_sites=[
            ProposedSite(
                location=c,
                assigned_customers=site_stats[i]["count"],
                assigned_weight=site_stats[i]["weight"],
            )
            for i, c in enumerate(centers)
        ],
        assignments=assignments,
        current_total_weighted_km=round(current, 1),
        proposed_total_weighted_km=round(proposed, 1),
        improvement_percent=round(improvement, 1),
    )


# ── Closest facility + Voronoi territories ───────────────────────────────────


def closest_facility(db: Session, org_id: int) -> ClosestFacilityOut:
    customers = _customers(db, org_id)
    warehouses = _warehouses(db, org_id)
    if not warehouses:
        raise ValidationFailedError("Atama analizi için en az bir depo gerekli")

    assignments: list[AssignmentLine] = []
    per_wh: dict[int, dict] = {
        w.id: {"count": 0, "weight": 0, "dist_sum": 0.0} for w in warehouses
    }
    for p in customers:
        best = min(warehouses, key=lambda w: geo.haversine_km(p.loc, w.loc))
        d_km = geo.haversine_km(p.loc, best.loc)
        stats = per_wh[best.id]
        stats["count"] += 1
        stats["weight"] += p.weight
        stats["dist_sum"] += d_km
        assignments.append(
            AssignmentLine(
                customer_id=p.id,
                from_location=p.loc,
                to_location=best.loc,
                weight=p.weight,
                distance_m=round(d_km * 1000, 1),
            )
        )

    territories = _voronoi_territories(db, org_id) if len(warehouses) >= 2 else []
    return ClosestFacilityOut(
        assignments=assignments,
        loads=[
            FacilityLoad(
                warehouse_id=w.id,
                warehouse_name=w.name,
                location=w.loc,
                customer_count=per_wh[w.id]["count"],
                total_weight=per_wh[w.id]["weight"],
                avg_distance_km=round(
                    per_wh[w.id]["dist_sum"] / per_wh[w.id]["count"], 1
                )
                if per_wh[w.id]["count"]
                else 0.0,
            )
            for w in warehouses
        ],
        territories=territories,
    )


def _voronoi_territories(db: Session, org_id: int) -> list[dict]:
    """Voronoi cells over warehouse points, clipped to a Turkey-scale envelope,
    each cell matched back to the warehouse it contains."""
    rows = db.execute(
        text(
            """
            WITH pts AS (
                SELECT id, location::geometry AS geom
                FROM warehouses WHERE org_id = :org
            ),
            vor AS (
                SELECT (ST_Dump(ST_VoronoiPolygons(
                    ST_Collect(geom), 0.0,
                    ST_MakeEnvelope(24.0, 34.0, 46.0, 43.5, 4326)
                ))).geom AS cell
                FROM pts
            )
            SELECT p.id,
                   ST_AsGeoJSON(ST_Intersection(
                       v.cell, ST_MakeEnvelope(24.0, 34.0, 46.0, 43.5, 4326)
                   ))
            FROM vor v
            JOIN pts p ON ST_Contains(v.cell, p.geom)
            """
        ),
        {"org": org_id},
    ).all()

    territories: list[dict] = []
    for wh_id, geojson in rows:
        geom = json.loads(geojson)
        if geom.get("type") != "Polygon" or not geom.get("coordinates"):
            continue
        territories.append(
            {
                "warehouse_id": wh_id,
                "ring": [
                    {"lat": lat, "lng": lng} for lng, lat in geom["coordinates"][0]
                ],
            }
        )
    return territories


# ── Coverage (rings, isochrone-ready) ────────────────────────────────────────


def coverage(db: Session, org_id: int) -> CoverageOut:
    customers = _customers(db, org_id)
    warehouses = db.scalars(
        select(Warehouse).where(Warehouse.org_id == org_id).order_by(Warehouse.id)
    ).all()

    # Try isochrones first when a key exists; any failure falls back to rings.
    iso_available = True
    iso_results: dict[int, list[dict]] = {}
    for wh in warehouses:
        result = ors.get_isochrones(db, wh)
        if result is None:
            iso_available = False
            break
        iso_results[wh.id] = result

    out_warehouses: list[WarehouseCoverage] = []
    covered_ids: set[int] = set()

    for wh in warehouses:
        center = geo.point_to_latlng(wh.location)
        bands: list[CoverageBand] = []
        prev_covered: set[int] = set()
        for r_km in RING_KM:
            in_ring = {
                p.id
                for p in customers
                if geo.haversine_km(p.loc, center) <= r_km
            }
            band_ids = in_ring - prev_covered
            band_weight = sum(p.weight for p in customers if p.id in band_ids)
            ring_geom = db.scalar(
                select(
                    func.ST_AsGeoJSON(
                        func.ST_Buffer(
                            cast(wh.location, Geography), r_km * 1000, 16
                        )
                    )
                )
            )
            coords = json.loads(ring_geom)["coordinates"][0]
            bands.append(
                CoverageBand(
                    radius_km=r_km,
                    ring=[LatLng(lat=lat, lng=lng) for lng, lat in coords],
                    customer_count=len(band_ids),
                    covered_weight=band_weight,
                )
            )
            prev_covered = in_ring
        covered_ids |= prev_covered
        out_warehouses.append(
            WarehouseCoverage(
                warehouse_id=wh.id,
                warehouse_name=wh.name,
                bands=bands,
                isochrones=iso_results.get(wh.id) if iso_available else None,
            )
        )

    uncovered = [p for p in customers if p.id not in covered_ids]
    return CoverageOut(
        mode="isochrone" if iso_available and warehouses else "rings",
        note=(
            "Sürüş süresi alanları (openrouteservice, 15/30/60 dk)"
            if iso_available and warehouses
            else (
                "Kuş uçuşu kapsama halkaları (10/25/50 km) — "
                "sürüş süresi için ORS_API_KEY tanımlayın"
            )
        ),
        warehouses=out_warehouses,
        uncovered_customers=len(uncovered),
        uncovered_weight=sum(p.weight for p in uncovered),
    )


# ── Inter-facility flow map ──────────────────────────────────────────────────


def flow_map(db: Session, org_id: int, day: str | None = None) -> FlowMapOut:
    """Depolar arası transfer arkları; `day` (YYYY-MM-DD) verilirse yalnız o
    günün transferleri — haritadaki zaman animasyonu gün gün çağırır."""
    from_loc = aliased(StorageLocation)
    to_loc = aliased(StorageLocation)
    from_wh = aliased(Warehouse)
    to_wh = aliased(Warehouse)
    stmt = (
        select(
            from_wh.id,
            from_wh.name,
            from_wh.location,
            to_wh.id,
            to_wh.name,
            to_wh.location,
            func.coalesce(func.sum(StockMovement.quantity), 0),
            func.count(),
        )
        .join(from_loc, StockMovement.from_location_id == from_loc.id)
        .join(to_loc, StockMovement.to_location_id == to_loc.id)
        .join(from_wh, from_loc.warehouse_id == from_wh.id)
        .join(to_wh, to_loc.warehouse_id == to_wh.id)
        .where(
            StockMovement.org_id == org_id,
            StockMovement.type == "transfer",
            from_wh.id != to_wh.id,
        )
        .group_by(from_wh.id, from_wh.name, from_wh.location, to_wh.id, to_wh.name, to_wh.location)
    )
    if day is not None:
        stmt = stmt.where(func.to_char(StockMovement.created_at, "YYYY-MM-DD") == day)
    rows = db.execute(stmt).all()
    return FlowMapOut(
        arcs=[
            FlowArc(
                from_warehouse_id=r[0],
                from_name=r[1],
                from_location=geo.point_to_latlng(r[2]),
                to_warehouse_id=r[3],
                to_name=r[4],
                to_location=geo.point_to_latlng(r[5]),
                total_quantity=int(r[6]),
                transfer_count=int(r[7]),
            )
            for r in rows
        ]
    )

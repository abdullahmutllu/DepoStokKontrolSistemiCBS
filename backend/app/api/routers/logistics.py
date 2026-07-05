"""Teslimat turları (VRP), canlı sevkiyat takibi ve what-if senaryosu.

Canlı takip mimarisi: araç konumu SAKLANMAZ. Her sevkiyat, oluşturulduğu
andaki durak planından deterministik bir `TrackPlan`a açılır ve "şu an"ın
konumu/ETA'sı `position_at(plan, geçen_sim_dk)` ile hesaplanır. Böylece
- REST GET her çağrıda günceldir (poll etmek yeter),
- WebSocket katmanı aynı fonksiyonu periyodik push'lar (SignalR muadili),
- tarayıcı-içi demo aynı motoru TS'te koşturur.
"""

import asyncio
import contextlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import ValidationFailedError
from app.core.security import decode_access_token
from app.models import Customer, Shipment, User, Warehouse
from app.schemas.logistics import (
    ScenarioOut,
    ScenarioRequest,
    ScenarioSide,
    ShipmentCreate,
    ShipmentDetailOut,
    ShipmentOut,
    StopEta,
    TourOut,
    TourStopOut,
    VehicleLive,
    VehicleRoutesOut,
    VehicleRoutesRequest,
)
from app.schemas.warehouse import LatLng
from app.services.geo import haversine_km, point_to_latlng
from app.services.scoping import get_owned_warehouse
from app.services.tracking import TrackStop, build_plan, position_at
from app.services.vrp import VrpStop, solve_vrp

router = APIRouter(tags=["logistics"])

SERVICE_MIN = 12.0  # durak başına teslimat/servis süresi (sim dk)
COVERAGE_LIMIT_KM = 50.0


def _org_warehouses(db: Session, org_id: int) -> list[Warehouse]:
    return list(db.scalars(select(Warehouse).where(Warehouse.org_id == org_id)).all())


def _customers_of(db: Session, org_id: int) -> list[tuple[Customer, LatLng]]:
    rows = db.scalars(select(Customer).where(Customer.org_id == org_id)).all()
    return [(c, point_to_latlng(c.location)) for c in rows]


# ── VRP: teslimat turları ────────────────────────────────────────────────────


@router.post("/network/vehicle-routes", response_model=VehicleRoutesOut)
def vehicle_routes(
    payload: VehicleRoutesRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VehicleRoutesOut:
    """Seçili depoya (en yakın atama ile) bağlı müşteriler için kapasiteli
    teslimat turları üretir — Clarke-Wright + 2-opt."""
    warehouse = get_owned_warehouse(db, user.org_id, payload.warehouse_id)
    depot = point_to_latlng(warehouse.location)
    warehouses = _org_warehouses(db, user.org_id)
    wh_points = {w.id: point_to_latlng(w.location) for w in warehouses}

    mine: list[VrpStop] = []
    for customer, loc in _customers_of(db, user.org_id):
        nearest = min(warehouses, key=lambda w: haversine_km(loc, wh_points[w.id]))
        if nearest.id == warehouse.id:
            mine.append(VrpStop(id=customer.id, lat=loc.lat, lng=loc.lng, demand=customer.weight))
    if len(mine) < 2:
        raise ValidationFailedError("Bu depoya atanmış en az 2 müşteri gerekli.")

    routes = solve_vrp(
        (depot.lat, depot.lng), mine, payload.vehicle_count, payload.capacity
    )
    by_id = {c.id: c for c, _ in _customers_of(db, user.org_id)}
    tours: list[TourOut] = []
    total_km = 0.0
    for i, route in enumerate(routes):
        stops = [
            TourStopOut(
                customer_id=s.id,
                name=by_id[s.id].name,
                location=LatLng(lat=s.lat, lng=s.lng),
                demand=s.demand,
                service_min=SERVICE_MIN,
            )
            for s in route.stops
        ]
        plan = build_plan(
            (depot.lat, depot.lng),
            [
                TrackStop(id=s.customer_id, name=s.name, lat=s.location.lat,
                          lng=s.location.lng, service_min=s.service_min)
                for s in stops
            ],
        )
        tours.append(
            TourOut(
                vehicle_name=f"Araç {i + 1}",
                stops=stops,
                distance_km=round(plan.total_km, 1),
                duration_min=round(plan.total_min, 1),
                load=route.load,
            )
        )
        total_km += plan.total_km

    return VehicleRoutesOut(
        warehouse_id=warehouse.id,
        vehicle_count=payload.vehicle_count,
        capacity=payload.capacity,
        tours=tours,
        total_km=round(total_km, 1),
        unassigned_customers=0,
        note=(
            f"Kuş uçuşu mesafeler + durak başına {SERVICE_MIN:.0f} dk servis. "
            "Turlar Clarke-Wright savings + 2-opt ile hesaplandı."
        ),
    )


# ── Sevkiyatlar (canlı takip) ────────────────────────────────────────────────


def _plan_of(shipment: Shipment):
    stops = [
        TrackStop(
            id=s["customer_id"], name=s["name"], lat=s["lat"], lng=s["lng"],
            service_min=s["service_min"],
        )
        for s in shipment.stops
    ]
    depot_row = shipment.stops[0].get("_depot") if shipment.stops else None
    # depot her sevkiyatta ayrıca saklanır (aşağıda create'te ilk elemana gömülü)
    depot = (depot_row["lat"], depot_row["lng"]) if depot_row else (0.0, 0.0)
    return build_plan(depot, stops, base_speed_kmh=shipment.base_speed_kmh)


def _elapsed_sim_min(shipment: Shipment, now: datetime) -> float:
    return max(
        -1.0,
        (now - shipment.depart_at).total_seconds() / 60.0 * shipment.time_scale,
    )


def _shipment_out(shipment: Shipment, now: datetime) -> ShipmentOut:
    plan = _plan_of(shipment)
    elapsed = _elapsed_sim_min(shipment, now)
    live = position_at(plan, elapsed)
    depot = shipment.stops[0]["_depot"]
    route = (
        [LatLng(lat=depot["lat"], lng=depot["lng"])]
        + [LatLng(lat=s["lat"], lng=s["lng"]) for s in shipment.stops]
        + [LatLng(lat=depot["lat"], lng=depot["lng"])]
    )
    return ShipmentOut(
        id=shipment.id,
        warehouse_id=shipment.warehouse_id,
        vehicle_name=shipment.vehicle_name,
        total_km=round(plan.total_km, 1),
        total_min=round(plan.total_min, 1),
        time_scale=shipment.time_scale,
        depart_at=shipment.depart_at,
        stop_count=len(shipment.stops),
        live=VehicleLive(
            status=live["status"],
            position=LatLng(**live["position"]),
            heading_deg=round(live["heading_deg"], 1),
            speed_kmh=round(live["speed_kmh"], 1),
            progress_percent=live["progress_percent"],
            completed_stops=live["completed_stops"],
            current_stop=(live["current_stop"] or {}).get("name"),
            next_stop=(live["next_stop"] or {}).get("name"),
            next_stop_eta_min=(
                round(live["next_stop"]["eta_min"], 1) if live["next_stop"] else None
            ),
            next_stop_remaining_km=(
                round(live["next_stop"]["remaining_km"], 1) if live["next_stop"] else None
            ),
            eta_return_min=round(live["eta_return_min"], 1),
            elapsed_sim_min=round(max(0.0, elapsed), 1),
        ),
        route=route,
    )


@router.post("/shipments", response_model=list[ShipmentOut], status_code=201)
def create_shipments(
    payload: ShipmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ShipmentOut]:
    """VRP turlarını canlı takip edilen sevkiyatlara dönüştürür. Araçlar
    30'ar saniye arayla yola çıkar (stagger) — harita anında canlanır."""
    warehouse = get_owned_warehouse(db, user.org_id, payload.warehouse_id)
    depot = point_to_latlng(warehouse.location)
    if not payload.tours:
        raise ValidationFailedError("En az bir tur gerekli.")

    now = datetime.now(UTC)
    created: list[Shipment] = []
    for i, tour in enumerate(payload.tours):
        if not tour.stops:
            continue
        stops = [
            {
                "customer_id": s.customer_id,
                "name": s.name,
                "lat": s.location.lat,
                "lng": s.location.lng,
                "demand": s.demand,
                "service_min": s.service_min,
            }
            for s in tour.stops
        ]
        # depot'u ilk durağa gömerek sakla — plan yeniden kurulurken lazım
        stops[0]["_depot"] = {"lat": depot.lat, "lng": depot.lng}
        plan = build_plan(
            (depot.lat, depot.lng),
            [
                TrackStop(id=s["customer_id"], name=s["name"], lat=s["lat"],
                          lng=s["lng"], service_min=s["service_min"])
                for s in stops
            ],
            base_speed_kmh=payload.base_speed_kmh,
        )
        shipment = Shipment(
            org_id=user.org_id,
            warehouse_id=warehouse.id,
            vehicle_name=tour.vehicle_name,
            stops=stops,
            base_speed_kmh=payload.base_speed_kmh,
            time_scale=payload.time_scale,
            total_km=plan.total_km,
            total_min=plan.total_min,
            depart_at=now + timedelta(seconds=30 * i),
        )
        db.add(shipment)
        created.append(shipment)
    db.commit()
    return [_shipment_out(s, datetime.now(UTC)) for s in created]


def _active_shipments(db: Session, org_id: int) -> list[Shipment]:
    since = datetime.now(UTC) - timedelta(hours=48)
    return list(
        db.scalars(
            select(Shipment)
            .where(Shipment.org_id == org_id, Shipment.created_at >= since)
            .order_by(Shipment.id)
        ).all()
    )


@router.get("/shipments/active", response_model=list[ShipmentOut])
def active_shipments(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ShipmentOut]:
    now = datetime.now(UTC)
    return [_shipment_out(s, now) for s in _active_shipments(db, user.org_id)]


@router.delete("/shipments", status_code=204)
def clear_shipments(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    for s in _active_shipments(db, user.org_id):
        db.delete(s)
    db.commit()


@router.get("/shipments/{shipment_id}", response_model=ShipmentDetailOut)
def shipment_detail(
    shipment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShipmentDetailOut:
    shipment = db.scalar(
        select(Shipment).where(Shipment.id == shipment_id, Shipment.org_id == user.org_id)
    )
    if shipment is None:
        raise ValidationFailedError("Sevkiyat bulunamadı.")
    now = datetime.now(UTC)
    base = _shipment_out(shipment, now)
    plan = _plan_of(shipment)
    elapsed = _elapsed_sim_min(shipment, now)

    stop_etas: list[StopEta] = []
    for idx, s in enumerate(shipment.stops):
        # durak varış zamanı = ilgili bacağın cum_arrive'ı (bacak idx == durak idx)
        arrive = plan.legs[idx].cum_arrive_min
        depart = arrive + s["service_min"]
        if elapsed >= depart:
            status = "done"
            eta = None
        elif elapsed >= arrive:
            status = "current"
            eta = 0.0
        else:
            status = "pending"
            eta = round(arrive - elapsed, 1)
        stop_etas.append(
            StopEta(
                customer_id=s["customer_id"],
                name=s["name"],
                location=LatLng(lat=s["lat"], lng=s["lng"]),
                demand=s["demand"],
                status=status,
                eta_min=eta,
                planned_arrive_min=round(arrive, 1),
            )
        )
    return ShipmentDetailOut(**base.model_dump(), stops=stop_etas)


# ── WebSocket: anlık konum yayını (SignalR muadili) ─────────────────────────


@router.websocket("/shipments/ws")
async def shipments_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
    db: Session = Depends(get_db),
) -> None:
    """2 sn'de bir org'un aktif sevkiyat anlık görüntüsünü push'lar.

    Kimlik: `?token=<JWT>` (tarayıcı WS'te Authorization başlığı taşıyamaz).
    İstemci düşerse döngü sonlanır; istemci WS kuramazsa frontend REST
    polling'e düşer (useShipmentsLive iki taşımayı da destekler).
    """
    payload = decode_access_token(token)
    if payload is None or "org_id" not in payload:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    org_id = int(payload["org_id"])
    try:
        while True:
            now = datetime.now(UTC)
            snapshot = [
                _shipment_out(s, now).model_dump(mode="json")
                for s in _active_shipments(db, org_id)
            ]
            await websocket.send_json({"type": "shipments", "data": snapshot})
            with contextlib.suppress(asyncio.TimeoutError):
                # istemci mesajı beklemiyoruz; timeout 2 sn tempoyu korur
                await asyncio.wait_for(websocket.receive_text(), timeout=2.0)
    except WebSocketDisconnect:
        return


# ── What-if senaryosu: depo kapat ────────────────────────────────────────────


def _scenario_side(
    warehouses: list[Warehouse],
    wh_points: dict[int, LatLng],
    customers: list[tuple[Customer, LatLng]],
) -> tuple[ScenarioSide, dict[int, int]]:
    assignment: dict[int, int] = {}
    total_weighted = 0.0
    total_dist = 0.0
    uncovered = 0
    loads: dict[int, dict] = {
        w.id: {
            "warehouse_id": w.id,
            "warehouse_name": w.name,
            "customer_count": 0,
            "total_weight": 0,
        }
        for w in warehouses
    }
    for customer, loc in customers:
        nearest = min(warehouses, key=lambda w: haversine_km(loc, wh_points[w.id]))
        dist = haversine_km(loc, wh_points[nearest.id])
        assignment[customer.id] = nearest.id
        total_weighted += dist * customer.weight
        total_dist += dist
        if dist > COVERAGE_LIMIT_KM:
            uncovered += 1
        loads[nearest.id]["customer_count"] += 1
        loads[nearest.id]["total_weight"] += customer.weight
    side = ScenarioSide(
        total_weighted_km=round(total_weighted, 1),
        avg_distance_km=round(total_dist / max(1, len(customers)), 1),
        uncovered_customers=uncovered,
        loads=list(loads.values()),
    )
    return side, assignment


@router.post("/network/scenario", response_model=ScenarioOut)
def scenario(
    payload: ScenarioRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScenarioOut:
    """Depo kapatma what-if'i: atamalar, ağırlıklı mesafe ve kapsama nasıl
    değişir? Ağ tasarımı araçlarının çekirdek sorusu."""
    warehouses = _org_warehouses(db, user.org_id)
    remaining = [w for w in warehouses if w.id not in payload.closed_warehouse_ids]
    if not remaining:
        raise ValidationFailedError("En az bir depo açık kalmalı.")
    if len(remaining) == len(warehouses):
        raise ValidationFailedError("Kapatılacak depo bu organizasyonda bulunamadı.")

    customers = _customers_of(db, user.org_id)
    if not customers:
        raise ValidationFailedError("Analiz için müşteri noktası yok.")
    wh_points = {w.id: point_to_latlng(w.location) for w in warehouses}

    baseline, base_assign = _scenario_side(warehouses, wh_points, customers)
    after, new_assign = _scenario_side(remaining, wh_points, customers)
    delta = after.total_weighted_km - baseline.total_weighted_km
    return ScenarioOut(
        closed_warehouse_ids=payload.closed_warehouse_ids,
        baseline=baseline,
        scenario=after,
        delta_weighted_km=round(delta, 1),
        delta_percent=round(delta / max(baseline.total_weighted_km, 0.001) * 100, 1),
        reassigned_customers=sum(
            1 for cid, wid in base_assign.items() if new_assign.get(cid) != wid
        ),
    )

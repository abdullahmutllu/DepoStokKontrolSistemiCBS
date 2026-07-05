"""Canlı araç takip motoru — durumsuz ve deterministik.

Konum = f(plan, geçen dakika). Arka plan görevi yok: her istek anında
hesaplanır. Aynı mantık tarayıcı demosuna taşınacağı için modül SAF kalır
(stdlib + math; db/FastAPI/pydantic importu yok).
"""

import math
from dataclasses import dataclass
from typing import Any

_EARTH_RADIUS_KM = 6371.0

STATUS_PENDING = "pending"
STATUS_EN_ROUTE = "en_route"
STATUS_AT_STOP = "at_stop"
STATUS_COMPLETED = "completed"


@dataclass
class TrackStop:
    """Rota üzerindeki müşteri durağı."""

    id: int
    name: str
    lat: float
    lng: float
    service_min: float


@dataclass
class Leg:
    """İki nokta arası bacak; kümülatif zamanlar servis bekleme sürelerini içerir."""

    from_lat: float
    from_lng: float
    to_lat: float
    to_lng: float
    distance_km: float
    speed_kmh: float
    travel_min: float
    cum_depart_min: float
    cum_arrive_min: float


@dataclass
class TrackPlan:
    """Depo -> duraklar -> depo turu; total_min servis süreleri ve dönüş dahil."""

    depot: tuple[float, float]
    stops: list[TrackStop]
    legs: list[Leg]
    total_km: float
    total_min: float


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """geo.haversine_km ile birebir aynı formül (r=6371). geo.py geoalchemy2 ve
    pydantic şemalarına bağımlı olduğundan saf kalmak için burada tuple kopyası
    tutuluyor (tarayıcı portu için de gerekli)."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat = lat2 - lat1
    dlng = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def leg_speed(base_kmh: float, leg_index: int) -> float:
    """Bacak hızı: deterministik 0.85–1.15 çarpanı.

    random yok; GLSL tarzı frac(sin(i*12.9898)*43758.5453) hash'i kullanılır.
    Ayrı fonksiyon: testler sabit hız için monkeypatch edebilir.
    """
    x = math.sin(leg_index * 12.9898) * 43758.5453
    frac = x - math.floor(x)
    return base_kmh * (0.85 + 0.30 * frac)


def build_plan(
    depot: tuple[float, float],
    stops: list[TrackStop],
    base_speed_kmh: float = 65.0,
) -> TrackPlan:
    """Rota planı: depot -> stops (sırayla) -> depot.

    Her durağa varışta service_min kadar bekleme kümülatif saate eklenir;
    total_min tüm sürüş + servis + depoya dönüşü kapsar.
    """
    if not stops:
        return TrackPlan(depot=depot, stops=[], legs=[], total_km=0.0, total_min=0.0)
    points: list[tuple[float, float]] = [depot, *((s.lat, s.lng) for s in stops), depot]
    legs: list[Leg] = []
    clock = 0.0
    total_km = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        distance_km = _haversine_km(a, b)
        speed_kmh = leg_speed(base_speed_kmh, i)
        travel_min = (distance_km / speed_kmh) * 60.0 if speed_kmh > 0 else 0.0
        legs.append(
            Leg(
                from_lat=a[0],
                from_lng=a[1],
                to_lat=b[0],
                to_lng=b[1],
                distance_km=distance_km,
                speed_kmh=speed_kmh,
                travel_min=travel_min,
                cum_depart_min=clock,
                cum_arrive_min=clock + travel_min,
            )
        )
        clock += travel_min
        total_km += distance_km
        if i < len(stops):  # varılan nokta bir durak ise servis beklemesi
            clock += stops[i].service_min
    return TrackPlan(depot=depot, stops=stops, legs=legs, total_km=total_km, total_min=clock)


def bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    """a -> b başlangıç yönü; kuzey=0°, saat yönünde 0–360."""
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlng = math.radians(b[1] - a[1])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return math.degrees(math.atan2(x, y)) % 360.0


def _progress_percent(elapsed_min: float, total_min: float) -> float:
    """Zaman bazlı ilerleme, 1 ondalık."""
    if total_min <= 0:
        return 100.0
    ratio = min(max(elapsed_min / total_min, 0.0), 1.0)
    return round(ratio * 100.0, 1)


def _stop_ref(stop: TrackStop) -> dict[str, Any]:
    return {"id": stop.id, "name": stop.name}


def position_at(plan: TrackPlan, elapsed_min: float) -> dict[str, Any]:
    """Verilen dakikadaki araç durumu (durumsuz hesap).

    status: pending (<0) | en_route | at_stop | completed (>= total_min).
    position: bacakta doğrusal interpolasyon; at_stop -> durak; pending ve
    completed -> depo. heading/speed yalnızca en_route iken sıfırdan farklı.
    """
    total = plan.total_min
    progress = _progress_percent(elapsed_min, total)
    depot_pos = {"lat": plan.depot[0], "lng": plan.depot[1]}

    if elapsed_min < 0:
        next_stop = None
        if plan.stops:
            first = plan.legs[0]
            next_stop = {
                **_stop_ref(plan.stops[0]),
                "eta_min": first.cum_arrive_min - elapsed_min,
                "remaining_km": first.distance_km,
            }
        return {
            "status": STATUS_PENDING,
            "position": depot_pos,
            "heading_deg": 0.0,
            "speed_kmh": 0.0,
            "completed_stops": 0,
            "current_stop": None,
            "next_stop": next_stop,
            "eta_return_min": total - elapsed_min,
            "progress_percent": progress,
        }

    if elapsed_min >= total:
        return {
            "status": STATUS_COMPLETED,
            "position": depot_pos,
            "heading_deg": 0.0,
            "speed_kmh": 0.0,
            "completed_stops": len(plan.stops),
            "current_stop": None,
            "next_stop": None,
            "eta_return_min": 0.0,
            "progress_percent": progress,
        }

    for i, leg in enumerate(plan.legs):
        if elapsed_min < leg.cum_arrive_min:  # bacakta yolda
            frac = 0.0
            if leg.travel_min > 0:
                frac = (elapsed_min - leg.cum_depart_min) / leg.travel_min
            lat = leg.from_lat + (leg.to_lat - leg.from_lat) * frac
            lng = leg.from_lng + (leg.to_lng - leg.from_lng) * frac
            next_stop = None
            if i < len(plan.stops):  # son bacak depoya dönüş; onun next_stop'u yok
                next_stop = {
                    **_stop_ref(plan.stops[i]),
                    "eta_min": leg.cum_arrive_min - elapsed_min,
                    "remaining_km": leg.distance_km * (1.0 - frac),
                }
            return {
                "status": STATUS_EN_ROUTE,
                "position": {"lat": lat, "lng": lng},
                "heading_deg": bearing_deg(
                    (leg.from_lat, leg.from_lng), (leg.to_lat, leg.to_lng)
                ),
                "speed_kmh": leg.speed_kmh,
                "completed_stops": min(i, len(plan.stops)),
                "current_stop": None,
                "next_stop": next_stop,
                "eta_return_min": total - elapsed_min,
                "progress_percent": progress,
            }
        if i < len(plan.stops) and elapsed_min < leg.cum_arrive_min + plan.stops[i].service_min:
            stop = plan.stops[i]  # servis penceresi: durakta bekliyor
            next_stop = None
            if i + 1 < len(plan.stops):
                next_leg = plan.legs[i + 1]
                next_stop = {
                    **_stop_ref(plan.stops[i + 1]),
                    "eta_min": next_leg.cum_arrive_min - elapsed_min,
                    "remaining_km": next_leg.distance_km,
                }
            return {
                "status": STATUS_AT_STOP,
                "position": {"lat": stop.lat, "lng": stop.lng},
                "heading_deg": 0.0,
                "speed_kmh": 0.0,
                "completed_stops": i,
                "current_stop": _stop_ref(stop),
                "next_stop": next_stop,
                "eta_return_min": total - elapsed_min,
                "progress_percent": progress,
            }

    # sayısal uç durumlar (float yuvarlama) tamamlanmış sayılır
    return {
        "status": STATUS_COMPLETED,
        "position": depot_pos,
        "heading_deg": 0.0,
        "speed_kmh": 0.0,
        "completed_stops": len(plan.stops),
        "current_stop": None,
        "next_stop": None,
        "eta_return_min": 0.0,
        "progress_percent": progress,
    }

"""tracking servisi testleri — saf fonksiyonlar, fixture gerekmez.

El hesabı için ekvator koordinatları kullanılır: ekvator üzerinde haversine
tam olarak R*Δλ'ya iner (dlat=0 -> 2R·asin(sin(Δλ/2)) = R·Δλ). leg_speed
60 km/h'a monkeypatch'lenince km == dakika olur ve ETA'lar elle doğrulanır.
"""

import math

import pytest

from app.services import tracking
from app.services.tracking import TrackStop, bearing_deg, build_plan, leg_speed, position_at

# ekvatorda 1° boylamın haversine mesafesi (km) — tam değer
DEG_KM = 6371.0 * math.radians(1.0)
DEPOT = (0.0, 0.0)


def _stops() -> list[TrackStop]:
    return [
        TrackStop(id=1, name="A", lat=0.0, lng=1.0, service_min=10.0),
        TrackStop(id=2, name="B", lat=0.0, lng=2.0, service_min=5.0),
    ]


def _flat_plan(monkeypatch: pytest.MonkeyPatch) -> tracking.TrackPlan:
    """Sabit 60 km/h: bacaklar DEG_KM, DEG_KM, 2*DEG_KM dk; toplam 4*DEG_KM+15."""
    monkeypatch.setattr(tracking, "leg_speed", lambda base_kmh, leg_index: 60.0)
    return build_plan(DEPOT, _stops())


def test_pending_before_departure() -> None:
    plan = build_plan(DEPOT, _stops())
    state = position_at(plan, -5.0)
    assert state["status"] == "pending"
    assert state["position"] == {"lat": DEPOT[0], "lng": DEPOT[1]}
    assert state["speed_kmh"] == 0.0
    assert state["completed_stops"] == 0
    assert state["current_stop"] is None
    assert state["progress_percent"] == 0.0
    assert state["eta_return_min"] == pytest.approx(plan.total_min + 5.0)


def test_departure_at_zero_is_at_depot() -> None:
    plan = build_plan(DEPOT, _stops())
    state = position_at(plan, 0.0)
    assert state["status"] == "en_route"
    assert state["position"] == {"lat": DEPOT[0], "lng": DEPOT[1]}
    assert state["speed_kmh"] == pytest.approx(plan.legs[0].speed_kmh)
    assert state["heading_deg"] == pytest.approx(bearing_deg(DEPOT, (0.0, 1.0)))
    assert state["current_stop"] is None
    assert state["completed_stops"] == 0


def test_mid_leg_interpolation_and_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    plan = _flat_plan(monkeypatch)
    elapsed = DEG_KM / 2  # ilk bacağın tam ortası
    state = position_at(plan, elapsed)
    assert state["status"] == "en_route"
    assert state["position"]["lat"] == pytest.approx(0.0)
    assert state["position"]["lng"] == pytest.approx(0.5)
    expected = round(elapsed / (4 * DEG_KM + 15.0) * 100.0, 1)
    assert state["progress_percent"] == expected


def test_at_stop_service_window(monkeypatch: pytest.MonkeyPatch) -> None:
    plan = _flat_plan(monkeypatch)
    elapsed = DEG_KM + 3.0  # A durağına varıştan 3 dk sonra (servis 10 dk)
    state = position_at(plan, elapsed)
    assert state["status"] == "at_stop"
    assert state["position"] == {"lat": 0.0, "lng": 1.0}
    assert state["current_stop"] == {"id": 1, "name": "A"}
    assert state["speed_kmh"] == 0.0
    assert state["completed_stops"] == 0
    # sıradaki durak B: varış = DEG_KM + 10 + DEG_KM -> eta = DEG_KM + 7
    assert state["next_stop"]["id"] == 2
    assert state["next_stop"]["eta_min"] == pytest.approx(DEG_KM + 7.0)
    assert state["next_stop"]["remaining_km"] == pytest.approx(DEG_KM)


def test_completed_back_at_depot() -> None:
    plan = build_plan(DEPOT, _stops())
    for elapsed in (plan.total_min, plan.total_min + 42.0):
        state = position_at(plan, elapsed)
        assert state["status"] == "completed"
        assert state["position"] == {"lat": DEPOT[0], "lng": DEPOT[1]}
        assert state["progress_percent"] == 100.0
        assert state["eta_return_min"] == 0.0
        assert state["completed_stops"] == 2
        assert state["next_stop"] is None


def test_next_stop_eta_by_hand(monkeypatch: pytest.MonkeyPatch) -> None:
    plan = _flat_plan(monkeypatch)
    state = position_at(plan, 30.0)  # ilk bacakta (DEG_KM ≈ 111.2 dk sürer)
    assert state["status"] == "en_route"
    assert state["next_stop"]["id"] == 1
    assert state["next_stop"]["name"] == "A"
    # 60 km/h -> 1 km = 1 dk: kalan km == kalan dk == DEG_KM - 30
    assert state["next_stop"]["eta_min"] == pytest.approx(DEG_KM - 30.0)
    assert state["next_stop"]["remaining_km"] == pytest.approx(DEG_KM - 30.0)
    assert state["eta_return_min"] == pytest.approx(4 * DEG_KM + 15.0 - 30.0)


def test_bearing_cardinal_directions() -> None:
    assert bearing_deg((0.0, 0.0), (1.0, 0.0)) == pytest.approx(0.0)  # kuzey
    assert bearing_deg((0.0, 0.0), (0.0, 1.0)) == pytest.approx(90.0)  # doğu


def test_total_min_is_travel_plus_service() -> None:
    stops = _stops()
    plan = build_plan(DEPOT, stops)
    expected = sum(leg.travel_min for leg in plan.legs) + sum(s.service_min for s in stops)
    assert plan.total_min == pytest.approx(expected)
    assert plan.total_km == pytest.approx(sum(leg.distance_km for leg in plan.legs))
    assert len(plan.legs) == len(stops) + 1  # depoya dönüş bacağı dahil


def test_leg_speed_bounds_and_determinism() -> None:
    base = 65.0
    values = [leg_speed(base, i) for i in range(50)]
    assert all(0.85 * base <= v <= 1.15 * base for v in values)
    assert values == [leg_speed(base, i) for i in range(50)]  # deterministik
    assert len(set(values)) > 1  # varyasyon gerçekten var

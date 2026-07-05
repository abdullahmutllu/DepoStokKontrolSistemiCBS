"""solve_vrp: Clarke-Wright + 2-opt saf birim testleri (db/fixture gerekmez).

Geometriler el hesabıyla doğrulandı: ~39° enleminde 0.01° boylam ≈ 0.864 km,
0.01° enlem ≈ 1.112 km; ekvatorda 1° ≈ 111.19 km.
"""

from itertools import pairwise

import pytest

from app.schemas.warehouse import LatLng
from app.services.geo import haversine_km
from app.services.vrp import VrpStop, _two_opt, solve_vrp

DEPOT = (39.0, 32.0)


def _stop(id_: int, lat: float, lng: float, demand: int = 1) -> VrpStop:
    return VrpStop(id=id_, lat=lat, lng=lng, demand=demand)


def _tour_km(depot: tuple[float, float], stops: list[VrpStop]) -> float:
    pts = [depot, *((s.lat, s.lng) for s in stops), depot]
    return sum(
        haversine_km(LatLng(lat=a[0], lng=a[1]), LatLng(lat=b[0], lng=b[1]))
        for a, b in pairwise(pts)
    )


def _all_ids(routes) -> list[int]:
    return sorted(s.id for r in routes for s in r.stops)


def test_empty_stops_returns_empty() -> None:
    assert solve_vrp(DEPOT, [], 3, 10) == []


def test_single_vehicle_tsp_order() -> None:
    # Depot + dikdörtgenin diğer üç köşesi: tek optimal tur depot->1->2->3->depot
    # (yaklaşık 1.112 + 1.123 + 1.112 + 1.123 = 4.47 km); köşegenli her sıra daha uzun.
    s1 = _stop(1, 39.010, 32.000)
    s2 = _stop(2, 39.010, 32.013)
    s3 = _stop(3, 39.000, 32.013)
    routes = solve_vrp(DEPOT, [s2, s3, s1], vehicle_count=1, capacity=10)

    assert len(routes) == 1
    route = routes[0]
    assert [s.id for s in route.stops] == [1, 2, 3]
    assert route.load == 3
    assert route.distance_km == round(_tour_km(DEPOT, [s1, s2, s3]), 1)
    assert 4.0 < route.distance_km < 5.0  # el hesabı ~4.47 km


def test_demand_over_capacity_splits_routes() -> None:
    stops = [
        _stop(1, 39.95, 32.80, demand=2),
        _stop(2, 39.96, 32.81, demand=3),
        _stop(3, 39.94, 32.82, demand=2),
        _stop(4, 39.97, 32.79, demand=3),
    ]
    routes = solve_vrp((39.93, 32.85), stops, vehicle_count=4, capacity=5)

    assert len(routes) >= 2  # toplam talep 10 > kapasite 5
    assert all(r.load <= 5 for r in routes)
    assert _all_ids(routes) == [1, 2, 3, 4]  # her durak tam bir kez


def test_every_route_within_capacity() -> None:
    stops = [
        _stop(1, 39.90, 32.70, demand=4),
        _stop(2, 39.91, 32.72, demand=3),
        _stop(3, 39.89, 32.74, demand=2),
        _stop(4, 39.93, 32.71, demand=5),
        _stop(5, 39.92, 32.75, demand=1),
        _stop(6, 39.88, 32.72, demand=3),
    ]
    routes = solve_vrp((39.90, 32.73), stops, vehicle_count=6, capacity=8)

    assert len(routes) >= 3  # toplam 18 / kapasite 8
    assert all(r.load <= 8 for r in routes)
    assert all(r.load == sum(s.demand for s in r.stops) for r in routes)
    assert all(r.distance_km > 0 for r in routes)
    assert _all_ids(routes) == [1, 2, 3, 4, 5, 6]


def test_two_opt_uncrosses_edges() -> None:
    # Kare köşeleri; [1,3,2,4] sırası iki köşegeni kesiştirir, 2-opt [1,2,3,4] yapar.
    s1 = _stop(1, 39.005, 32.005)
    s2 = _stop(2, 39.005, 32.015)
    s3 = _stop(3, 38.995, 32.015)
    s4 = _stop(4, 38.995, 32.005)
    crossed = [s1, s3, s2, s4]

    fixed = _two_opt(DEPOT, crossed)

    assert [s.id for s in fixed] == [1, 2, 3, 4]
    assert _tour_km(DEPOT, fixed) < _tour_km(DEPOT, crossed) - 0.5


def test_solve_square_gives_perimeter_tour() -> None:
    s1 = _stop(1, 39.005, 32.005)
    s2 = _stop(2, 39.005, 32.015)
    s3 = _stop(3, 38.995, 32.015)
    s4 = _stop(4, 38.995, 32.005)
    routes = solve_vrp(DEPOT, [s3, s1, s4, s2], vehicle_count=1, capacity=10)

    assert len(routes) == 1
    route = routes[0]
    assert [s.id for s in route.stops] == [1, 2, 3, 4]  # çevre turu, kesişme yok
    assert route.distance_km == round(_tour_km(DEPOT, [s1, s2, s3, s4]), 1)
    assert route.distance_km == pytest.approx(4.2, abs=0.05)  # el hesabı ~4.25 km


def test_force_reduce_to_vehicle_count() -> None:
    # Ekvator üzerinde depodan geçen doğru: karşı yönlerdeki çiftlerin Clarke-Wright
    # tasarrufu 0 olduğundan CW üç rota bırakır; kapasite 7 iken 1+2 (yük 8) CW'de
    # birleşemez ama küçük rota 3 (yük 2) en yakın rota 1'e taşınarak 2 araca iner.
    depot = (0.0, 32.0)
    s1 = _stop(1, 0.0, 31.8, demand=4)  # batı
    s2 = _stop(2, 0.0, 31.0, demand=4)  # uzak batı
    s3 = _stop(3, 0.0, 32.4, demand=2)  # doğu
    routes = solve_vrp(depot, [s1, s2, s3], vehicle_count=2, capacity=7)

    assert len(routes) == 2
    assert [[s.id for s in r.stops] for r in routes] == [[1, 3], [2]]
    assert [r.load for r in routes] == [6, 4]
    assert all(r.load <= 7 for r in routes)
    assert routes[0].distance_km == pytest.approx(133.4, abs=0.1)  # (0.2+0.6+0.4)° * 111.19
    assert routes[1].distance_km == pytest.approx(222.4, abs=0.1)  # 2 * 1.0° * 111.19


def test_reduce_impossible_leaves_extra_routes() -> None:
    # Kapasite hiçbir birleşmeye izin vermiyor: vehicle_count=1 istense de 2 rota kalır.
    s1 = _stop(1, 39.90, 32.70, demand=5)
    s2 = _stop(2, 39.95, 32.90, demand=5)
    routes = solve_vrp((39.93, 32.80), [s1, s2], vehicle_count=1, capacity=6)

    assert len(routes) == 2
    assert all(r.load <= 6 for r in routes)
    assert _all_ids(routes) == [1, 2]

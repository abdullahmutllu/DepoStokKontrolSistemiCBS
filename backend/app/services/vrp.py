"""Kapasiteli Araç Rotalama (CVRP): Clarke-Wright savings + rota içi 2-opt.

Saf modül: db/FastAPI importu yok; mesafeler `geo.haversine_km` ile hesaplanır.

Algoritma:
1) Her durak kendi rotası (depot -> durak -> depot).
2) Clarke-Wright: s(i,j) = d(depot,i) + d(depot,j) - d(i,j); tasarruflar azalan
   sırayla gezilir, kapasite uygunsa ve i rota SONU / j rota BAŞI ise rotalar
   birleştirilir; hiç birleşme kalmayana kadar sürdürülür.
3) Rota sayısı vehicle_count'u aşarsa en küçük yüklü rotalar, kapasitesi yeten
   en yakın rotaya eklenerek zorla indirilir. Kapasite hiçbir birleşmeye izin
   vermiyorsa fazla rota kalabilir — araç sayısı garanti DEĞİLDİR.
4) Her rotaya depot uçları sabit 2-opt uygulanır.

Determinizm: tasarruf eşitliğinde (i.id, j.id) küçük olan önce işlenir; tur
mesafesi simetrik olduğundan rota yönü "ilk durak id'si < son durak id'si"
olacak şekilde sabitlenir ve sonuç rotaları ilk durak id'sine göre sıralanır.
"""

from dataclasses import dataclass
from itertools import pairwise

from app.schemas.warehouse import LatLng
from app.services.geo import haversine_km

# Sıfıra çok yakın (ör. depodan geçen büyük çember üzerinde iki yana açılan
# duraklar) tasarruflar birleşme sayılmaz.
_EPS_KM = 1e-9

_Coord = tuple[float, float]  # (lat, lng)


@dataclass
class VrpStop:
    id: int
    lat: float
    lng: float
    demand: int


@dataclass
class VrpRoute:
    stops: list[VrpStop]
    distance_km: float
    load: int


def _dist_km(a: _Coord, b: _Coord) -> float:
    return haversine_km(LatLng(lat=a[0], lng=a[1]), LatLng(lat=b[0], lng=b[1]))


def _route_distance_km(depot: _Coord, stops: list[VrpStop]) -> float:
    """Depot -> duraklar -> depot tam tur mesafesi (km)."""
    if not stops:
        return 0.0
    pts: list[_Coord] = [depot, *((s.lat, s.lng) for s in stops), depot]
    return sum(_dist_km(a, b) for a, b in pairwise(pts))


def _two_opt(depot: _Coord, stops: list[VrpStop]) -> list[VrpStop]:
    """Depot uçları sabit rota içi 2-opt: kesişen kenarları segment ters çevirerek açar."""
    n = len(stops)
    if n < 3:
        return list(stops)
    coords: list[_Coord] = [(s.lat, s.lng) for s in stops]
    d0 = [_dist_km(depot, c) for c in coords]
    dm = [[_dist_km(a, b) for b in coords] for a in coords]
    idx = list(range(n))
    improved = True
    while improved:
        improved = False
        for i in range(n - 1):
            for j in range(i + 1, n):
                before = (d0[idx[i]] if i == 0 else dm[idx[i - 1]][idx[i]]) + (
                    d0[idx[j]] if j == n - 1 else dm[idx[j]][idx[j + 1]]
                )
                after = (d0[idx[j]] if i == 0 else dm[idx[i - 1]][idx[j]]) + (
                    d0[idx[i]] if j == n - 1 else dm[idx[i]][idx[j + 1]]
                )
                if after < before - _EPS_KM:
                    idx[i : j + 1] = idx[i : j + 1][::-1]
                    improved = True
    return [stops[k] for k in idx]


def _route_load(route: list[int], stops: list[VrpStop]) -> int:
    return sum(stops[k].demand for k in route)


def solve_vrp(
    depot: _Coord,
    stops: list[VrpStop],
    vehicle_count: int,
    capacity: int,
) -> list[VrpRoute]:
    """Kapasiteli VRP çöz; modül docstring'indeki adımları uygular.

    Not: rota sayısı, kapasite zorla indirmeye izin vermezse vehicle_count'u
    aşabilir. Boş `stops` için boş liste döner.
    """
    if not stops:
        return []

    n = len(stops)
    coords: list[_Coord] = [(s.lat, s.lng) for s in stops]
    d0 = [_dist_km(depot, c) for c in coords]
    dm = [[_dist_km(a, b) for b in coords] for a in coords]

    # 1) Her durak kendi rotası.
    routes: list[list[int]] = [[k] for k in range(n)]
    loads: list[int] = [s.demand for s in stops]
    route_of: list[int] = list(range(n))

    # 2) Clarke-Wright savings; eşitlikte (i.id, j.id) küçük önce.
    savings: list[tuple[float, int, int, int, int]] = sorted(
        (
            (d0[i] + d0[j] - dm[i][j], stops[i].id, stops[j].id, i, j)
            for i in range(n)
            for j in range(n)
            if i != j
        ),
        key=lambda t: (-t[0], t[1], t[2]),
    )
    merged = True
    while merged:
        merged = False
        for saving, _, _, i, j in savings:
            if saving <= _EPS_KM:
                break  # kalan çiftlerin tasarrufu yok
            a, b = route_of[i], route_of[j]
            if a == b or routes[a][-1] != i or routes[b][0] != j:
                continue
            if loads[a] + loads[b] > capacity:
                continue
            routes[a].extend(routes[b])
            loads[a] += loads[b]
            for k in routes[b]:
                route_of[k] = a
            routes[b] = []
            merged = True
    active = [r for r in routes if r]

    # 3) Zorla indirme: en küçük yüklü rotayı, kapasitesi yeten en yakın
    # rotaya ekle; hiçbir taşıma mümkün değilse fazla rota kalır.
    while len(active) > vehicle_count:
        active.sort(key=lambda r: (_route_load(r, stops), min(stops[k].id for k in r)))
        moved = False
        for si, src in enumerate(active):
            src_load = _route_load(src, stops)
            best: int | None = None
            best_key: tuple[float, int] | None = None
            for ti, tgt in enumerate(active):
                if ti == si or _route_load(tgt, stops) + src_load > capacity:
                    continue
                key = (
                    min(dm[u][v] for u in src for v in tgt),
                    min(stops[k].id for k in tgt),
                )
                if best_key is None or key < best_key:
                    best, best_key = ti, key
            if best is not None:
                active[best].extend(src)
                del active[si]
                moved = True
                break
        if not moved:
            break

    # 4-5) Rota içi 2-opt, yön sabitleme, tam tur mesafesi (1 ondalık).
    result: list[VrpRoute] = []
    for r in active:
        ordered = _two_opt(depot, [stops[k] for k in r])
        if ordered[0].id > ordered[-1].id:
            ordered.reverse()  # tur simetrik: yönü deterministik yap
        result.append(
            VrpRoute(
                stops=ordered,
                distance_km=round(_route_distance_km(depot, ordered), 1),
                load=sum(s.demand for s in ordered),
            )
        )
    result.sort(key=lambda route: route.stops[0].id)
    return result

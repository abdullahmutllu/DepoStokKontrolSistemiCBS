"""WGS84 helpers for warehouse map placement.

Warehouse *position* lives in PostGIS (lat/lng); the *interior* layout uses a
flat, meter-based cartesian frame handled elsewhere. Keep the two apart.
"""

import math

from geoalchemy2 import WKBElement, WKTElement
from geoalchemy2.shape import to_shape

from app.schemas.warehouse import LatLng

_EARTH_M_PER_DEG_LAT = 111_320.0


def latlng_to_point(loc: LatLng) -> WKTElement:
    return WKTElement(f"POINT({loc.lng} {loc.lat})", srid=4326)


def point_to_latlng(value: WKBElement | WKTElement | None) -> LatLng | None:
    if value is None:
        return None
    geom = to_shape(value)
    return LatLng(lat=geom.y, lng=geom.x)


def footprint_polygon(center: LatLng, width_m: float, depth_m: float) -> WKTElement:
    """Approximate geographic rectangle around the center, for map rendering."""
    dlat = (depth_m / 2) / _EARTH_M_PER_DEG_LAT
    dlng = (width_m / 2) / (_EARTH_M_PER_DEG_LAT * math.cos(math.radians(center.lat)) or 1e-9)
    ring = [
        (center.lng - dlng, center.lat - dlat),
        (center.lng + dlng, center.lat - dlat),
        (center.lng + dlng, center.lat + dlat),
        (center.lng - dlng, center.lat + dlat),
        (center.lng - dlng, center.lat - dlat),
    ]
    coords = ", ".join(f"{lng} {lat}" for lng, lat in ring)
    return WKTElement(f"POLYGON(({coords}))", srid=4326)


def polygon_to_ring(value: WKBElement | WKTElement | None) -> list[LatLng] | None:
    if value is None:
        return None
    geom = to_shape(value)
    return [LatLng(lat=y, lng=x) for x, y in geom.exterior.coords]


def haversine_km(a: LatLng, b: LatLng) -> float:
    """Great-circle distance in km — network analysis over ~60 demand points
    is cheaper and more testable in Python than round-tripping PostGIS."""
    r = 6371.0
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlng = math.radians(b.lng - a.lng)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def ring_to_polygon(ring: list[LatLng]) -> WKTElement:
    """User-drawn ring → PostGIS polygon. Auto-closes; needs ≥3 distinct vertices."""
    points = [(p.lng, p.lat) for p in ring]
    if points and points[0] == points[-1]:
        points = points[:-1]
    distinct = list(dict.fromkeys(points))
    if len(distinct) < 3:
        from app.core.errors import ValidationFailedError

        raise ValidationFailedError("Bölge için en az 3 farklı köşe noktası gerekli")
    closed = [*points, points[0]]
    coords = ", ".join(f"{lng} {lat}" for lng, lat in closed)
    return WKTElement(f"POLYGON(({coords}))", srid=4326)

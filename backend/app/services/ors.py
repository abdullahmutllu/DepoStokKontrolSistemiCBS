"""openrouteservice isochrones with a Postgres cache.

The free tier allows ~500 isochrone requests/day, so every successful response
is cached per (warehouse, minutes); repeated map views cost zero quota.
No key / any failure → returns None and coverage degrades to crow-flies rings
(same graceful pattern as the AI layer). Never raises to the router.
"""

import logging

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import IsochroneCache, Warehouse
from app.services import geo

logger = logging.getLogger("depo.ors")

MINUTE_BANDS = [15, 30, 60]  # driving profile caps at 60 min on the free API


def _call_ors(lng: float, lat: float, minutes: list[int]) -> dict | None:
    """Single seam for tests. Returns the ORS FeatureCollection or None."""
    settings = get_settings()
    if not settings.ors_api_key:
        return None
    try:
        response = httpx.post(
            f"{settings.ors_base_url}/v2/isochrones/driving-car",
            headers={
                "Authorization": settings.ors_api_key,
                "Content-Type": "application/json",
            },
            json={
                "locations": [[lng, lat]],
                "range": [m * 60 for m in minutes],
                "range_type": "time",
            },
            timeout=20.0,
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or "features" not in data:
            return None
        return data
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("ORS isochrone call failed: %s", exc)
        return None


def get_isochrones(db: Session, warehouse: Warehouse) -> list[dict] | None:
    """Returns [{minutes, geometry(GeoJSON)}] for the warehouse, or None when
    isochrones are unavailable (no key / API failure)."""
    cached = db.scalars(
        select(IsochroneCache).where(IsochroneCache.warehouse_id == warehouse.id)
    ).all()
    by_minutes = {c.minutes: c.geojson for c in cached}
    if all(m in by_minutes for m in MINUTE_BANDS):
        return [{"minutes": m, "geometry": by_minutes[m]} for m in MINUTE_BANDS]

    center = geo.point_to_latlng(warehouse.location)
    if center is None:
        return None
    data = _call_ors(center.lng, center.lat, MINUTE_BANDS)
    if data is None:
        return None

    # ORS returns features sorted by range value ascending.
    out: list[dict] = []
    for feature in data.get("features", []):
        seconds = feature.get("properties", {}).get("value")
        geometry = feature.get("geometry")
        if seconds is None or geometry is None:
            continue
        minutes = int(round(seconds / 60))
        if minutes not in MINUTE_BANDS:
            continue
        if minutes not in by_minutes:
            db.add(
                IsochroneCache(
                    warehouse_id=warehouse.id, minutes=minutes, geojson=geometry
                )
            )
            by_minutes[minutes] = geometry
        out.append({"minutes": minutes, "geometry": geometry})
    db.flush()
    return out if len(out) == len(MINUTE_BANDS) else None

"""DXF floor-plan import via ezdxf.

Layer convention (case-insensitive): RACK, AISLE, ZONE, WALL.
Closed polylines on RACK/AISLE/ZONE become axis-aligned rectangles (AABB fit —
oriented-rectangle fitting would slot in here); LINE/polyline segments on WALL
become wall segments. Units scale from the $INSUNITS header to meters.
DWG is not supported; users convert to DXF first (see README).
"""

import tempfile
from pathlib import Path

import ezdxf
from ezdxf.entities import Line, LWPolyline, Polyline

from app.core.errors import ValidationFailedError
from app.schemas.dxf import DxfPreview, DxfRect, DxfSegment

_LAYERS = {"RACK", "AISLE", "ZONE", "WALL"}

# $INSUNITS → meters multiplier (0/unitless assumed meters)
_UNIT_SCALE = {0: 1.0, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}
_UNIT_NAME = {0: "unitless", 1: "inch", 2: "foot", 4: "mm", 5: "cm", 6: "m", 14: "dm"}


def _entity_points(entity) -> list[tuple[float, float]]:
    if isinstance(entity, LWPolyline):
        return [(p[0], p[1]) for p in entity.get_points()]
    if isinstance(entity, Polyline):
        return [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
    return []


def _is_closed(entity) -> bool:
    if isinstance(entity, (LWPolyline, Polyline)):
        return bool(entity.is_closed)
    return False


def parse_dxf(file_bytes: bytes) -> DxfPreview:
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        try:
            doc = ezdxf.readfile(tmp_path)
        except Exception as exc:  # DXFStructureError, UnicodeDecodeError, ...
            raise ValidationFailedError(
                "DXF dosyası okunamadı. Dosyanın geçerli bir DXF olduğundan emin olun "
                "(DWG desteklenmez; önce DXF'e çevirin)."
            ) from exc

        insunits = int(doc.header.get("$INSUNITS", 0))
        scale = _UNIT_SCALE.get(insunits)
        warnings: list[str] = []
        if scale is None:
            scale = 1.0
            warnings.append(
                f"Bilinmeyen birim kodu ($INSUNITS={insunits}); metre varsayıldı."
            )

        rects: dict[str, list[DxfRect]] = {"RACK": [], "AISLE": [], "ZONE": []}
        walls: list[DxfSegment] = []
        found_layers: set[str] = set()
        all_points: list[tuple[float, float]] = []

        for entity in doc.modelspace():
            layer = (entity.dxf.layer or "").upper()
            if layer not in _LAYERS:
                continue
            found_layers.add(layer)

            if layer == "WALL":
                if isinstance(entity, Line):
                    seg = DxfSegment(
                        x1=entity.dxf.start.x * scale,
                        y1=entity.dxf.start.y * scale,
                        x2=entity.dxf.end.x * scale,
                        y2=entity.dxf.end.y * scale,
                    )
                    walls.append(seg)
                    all_points += [(seg.x1, seg.y1), (seg.x2, seg.y2)]
                else:
                    pts = [(x * scale, y * scale) for x, y in _entity_points(entity)]
                    for a, b in zip(pts, pts[1:], strict=False):
                        walls.append(DxfSegment(x1=a[0], y1=a[1], x2=b[0], y2=b[1]))
                    all_points += pts
                continue

            pts = _entity_points(entity)
            if not pts:
                continue
            if not _is_closed(entity) and layer == "RACK":
                warnings.append(
                    f"{layer} katmanında kapalı olmayan bir çizgi atlandı "
                    "(raflar kapalı dikdörtgen olmalı)."
                )
                continue
            xs = [x * scale for x, _ in pts]
            ys = [y * scale for _, y in pts]
            rect = DxfRect(
                x=min(xs), y=min(ys), w=max(xs) - min(xs), d=max(ys) - min(ys), rotation=0.0
            )
            if rect.w <= 0 or rect.d <= 0:
                warnings.append(f"{layer} katmanında sıfır boyutlu bir şekil atlandı.")
                continue
            rects[layer].append(rect)
            all_points += list(zip(xs, ys, strict=False))

        if not found_layers:
            raise ValidationFailedError(
                "DXF'te beklenen katmanlar bulunamadı. Katman adları RACK, AISLE, ZONE, "
                "WALL olmalı (büyük/küçük harf önemsiz)."
            )
        if not rects["RACK"]:
            raise ValidationFailedError(
                "RACK katmanında kapalı dikdörtgen bulunamadı; en az bir raf gerekli."
            )

        min_x = min(x for x, _ in all_points)
        min_y = min(y for _, y in all_points)

        def _shift_rect(r: DxfRect) -> DxfRect:
            return DxfRect(x=r.x - min_x, y=r.y - min_y, w=r.w, d=r.d, rotation=r.rotation)

        return DxfPreview(
            units=_UNIT_NAME.get(insunits, str(insunits)),
            scale_applied=scale,
            bounds_w=max(x for x, _ in all_points) - min_x,
            bounds_d=max(y for _, y in all_points) - min_y,
            racks=[_shift_rect(r) for r in rects["RACK"]],
            zones=[_shift_rect(r) for r in rects["ZONE"]],
            aisles=[_shift_rect(r) for r in rects["AISLE"]],
            walls=[
                DxfSegment(x1=w.x1 - min_x, y1=w.y1 - min_y, x2=w.x2 - min_x, y2=w.y2 - min_y)
                for w in walls
            ],
            warnings=warnings,
        )
    finally:
        tmp_path.unlink(missing_ok=True)

"""Generates the storage_locations hierarchy from 2D rack placements.

Codes follow the Z1-A2-R3-S2-B4 convention (zone-aisle-rack-shelf-bin), built
parent-prefix style. Positions and dimensions are meters in the warehouse-local
cartesian frame. Re-running the builder continues from existing indices, so
codes never collide; unique(warehouse_id, code) is the DB backstop.
"""

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationFailedError
from app.models import StorageLocation
from app.schemas.location import LayoutGenerateRequest, LayoutGenerateResult, RackPlacement
from app.services.scoping import get_owned_warehouse


def _next_index(codes: list[str], pattern: str) -> int:
    best = 0
    rx = re.compile(pattern)
    for code in codes:
        m = rx.fullmatch(code)
        if m:
            best = max(best, int(m.group(1)))
    return best + 1


@dataclass
class _RackGroup:
    row: int
    racks: list[RackPlacement]


def _group_into_aisles(racks: list[RackPlacement]) -> list[_RackGroup]:
    """Racks sharing a row band form an aisle, ordered bottom-up then left-right."""
    by_row: dict[int, list[RackPlacement]] = {}
    for rack in racks:
        by_row.setdefault(rack.row, []).append(rack)
    groups = [
        _RackGroup(row=row, racks=sorted(items, key=lambda r: r.col))
        for row, items in sorted(by_row.items())
    ]
    return groups


def generate_layout(
    db: Session, org_id: int, warehouse_id: int, payload: LayoutGenerateRequest
) -> LayoutGenerateResult:
    warehouse = get_owned_warehouse(db, org_id, warehouse_id)
    cell = payload.cell_size

    for rack in payload.racks:
        if (rack.col + rack.w_cells) * cell > warehouse.local_width + 1e-6 or (
            rack.row + rack.d_cells
        ) * cell > warehouse.local_depth + 1e-6:
            raise ValidationFailedError(
                f"Raf ({rack.col},{rack.row}) depo sınırlarının dışına taşıyor "
                f"({warehouse.local_width}x{warehouse.local_depth} m)"
            )

    existing_codes = list(
        db.scalars(
            select(StorageLocation.code).where(StorageLocation.warehouse_id == warehouse.id)
        ).all()
    )

    # Zone: reuse if the caller names an existing one, otherwise mint the next Z index.
    zone: StorageLocation | None = None
    if payload.zone_code:
        zone = db.scalar(
            select(StorageLocation).where(
                StorageLocation.warehouse_id == warehouse.id,
                StorageLocation.code == payload.zone_code,
                StorageLocation.type == "zone",
            )
        )
        if zone is None and payload.zone_code in existing_codes:
            raise ValidationFailedError(
                f"'{payload.zone_code}' kodu zone olmayan bir lokasyona ait"
            )

    if zone is None:
        zone_code = payload.zone_code or f"Z{_next_index(existing_codes, r'Z(\d+)')}"
        min_x = min(r.col for r in payload.racks) * cell
        min_y = min(r.row for r in payload.racks) * cell
        max_x = max((r.col + r.w_cells) for r in payload.racks) * cell
        max_y = max((r.row + r.d_cells) for r in payload.racks) * cell
        zone = StorageLocation(
            warehouse_id=warehouse.id,
            parent_id=None,
            type="zone",
            code=zone_code,
            label=payload.zone_label,
            pos_x=min_x,
            pos_y=min_y,
            pos_z=0.0,
            dim_w=max_x - min_x,
            dim_d=max_y - min_y,
            dim_h=max(r.shelf_count * r.shelf_height for r in payload.racks),
            rotation=0.0,
        )
        db.add(zone)
        db.flush()

    aisle_start = _next_index(existing_codes, re.escape(zone.code) + r"-A(\d+)")

    created_aisles = created_racks = created_shelves = created_bins = 0
    sample_codes: list[str] = []

    for aisle_offset, group in enumerate(_group_into_aisles(payload.racks)):
        aisle_code = f"{zone.code}-A{aisle_start + aisle_offset}"
        a_min_x = min(r.col for r in group.racks) * cell
        a_max_x = max((r.col + r.w_cells) for r in group.racks) * cell
        aisle = StorageLocation(
            warehouse_id=warehouse.id,
            parent_id=zone.id,
            type="aisle",
            code=aisle_code,
            pos_x=a_min_x,
            pos_y=group.row * cell,
            pos_z=0.0,
            dim_w=a_max_x - a_min_x,
            dim_d=max(r.d_cells for r in group.racks) * cell,
            dim_h=max(r.shelf_count * r.shelf_height for r in group.racks),
            rotation=0.0,
        )
        db.add(aisle)
        db.flush()
        created_aisles += 1

        for rack_offset, rack in enumerate(group.racks, start=1):
            rack_code = f"{aisle_code}-R{rack_offset}"
            rack_w = rack.w_cells * cell
            rack_d = rack.d_cells * cell
            rack_loc = StorageLocation(
                warehouse_id=warehouse.id,
                parent_id=aisle.id,
                type="rack",
                code=rack_code,
                pos_x=rack.col * cell,
                pos_y=rack.row * cell,
                pos_z=0.0,
                dim_w=rack_w,
                dim_d=rack_d,
                dim_h=rack.shelf_count * rack.shelf_height,
                rotation=rack.rotation,
            )
            db.add(rack_loc)
            db.flush()
            created_racks += 1

            bin_w = rack_w / rack.bins_per_shelf
            for level in range(1, rack.shelf_count + 1):
                shelf_code = f"{rack_code}-S{level}"
                shelf = StorageLocation(
                    warehouse_id=warehouse.id,
                    parent_id=rack_loc.id,
                    type="shelf",
                    code=shelf_code,
                    pos_x=rack_loc.pos_x,
                    pos_y=rack_loc.pos_y,
                    pos_z=(level - 1) * rack.shelf_height,
                    dim_w=rack_w,
                    dim_d=rack_d,
                    dim_h=rack.shelf_height,
                    rotation=rack.rotation,
                )
                db.add(shelf)
                db.flush()
                created_shelves += 1

                bins = [
                    StorageLocation(
                        warehouse_id=warehouse.id,
                        parent_id=shelf.id,
                        type="bin",
                        code=f"{shelf_code}-B{i}",
                        pos_x=rack_loc.pos_x + (i - 1) * bin_w,
                        pos_y=rack_loc.pos_y,
                        pos_z=shelf.pos_z,
                        dim_w=bin_w,
                        dim_d=rack_d,
                        dim_h=rack.shelf_height,
                        rotation=rack.rotation,
                        capacity=rack.bin_capacity,
                    )
                    for i in range(1, rack.bins_per_shelf + 1)
                ]
                db.add_all(bins)
                created_bins += len(bins)
                if len(sample_codes) < 5:
                    sample_codes.extend(b.code for b in bins[: 5 - len(sample_codes)])

    db.flush()
    return LayoutGenerateResult(
        zone_id=zone.id,
        zone_code=zone.code,
        created_aisles=created_aisles,
        created_racks=created_racks,
        created_shelves=created_shelves,
        created_bins=created_bins,
        sample_codes=sample_codes,
    )

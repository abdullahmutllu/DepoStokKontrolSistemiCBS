import re

import pytest
from sqlalchemy import select

from app.core.errors import ValidationFailedError
from app.models import StorageLocation
from app.schemas.location import LayoutGenerateRequest, RackPlacement
from app.services import layout_builder

CODE_RX = re.compile(r"^Z\d+(-A\d+(-R\d+(-S\d+(-B\d+)?)?)?)?$")


def _all_locations(db, warehouse_id):
    return list(
        db.scalars(
            select(StorageLocation).where(StorageLocation.warehouse_id == warehouse_id)
        ).all()
    )


def _request(racks=None, cell=0.5):
    racks = racks or [
        RackPlacement(
            col=2, row=2, w_cells=8, d_cells=2,
            shelf_count=3, bins_per_shelf=4, shelf_height=1.5, bin_capacity=100,
        ),
        RackPlacement(
            col=12, row=2, w_cells=8, d_cells=2,
            shelf_count=3, bins_per_shelf=4, shelf_height=1.5, bin_capacity=100,
        ),
        RackPlacement(
            col=2, row=8, w_cells=6, d_cells=2,
            shelf_count=2, bins_per_shelf=3, shelf_height=2.0, bin_capacity=50,
        ),
    ]
    return LayoutGenerateRequest(cell_size=cell, racks=racks)


class TestGeneration:
    def test_counts_and_hierarchy(self, db, org_factory, warehouse_factory):
        org = org_factory()
        wh = warehouse_factory(org)
        result = layout_builder.generate_layout(db, org.id, wh.id, _request())

        # Row 2 has two racks (one aisle), row 8 has one (second aisle).
        assert result.created_aisles == 2
        assert result.created_racks == 3
        assert result.created_shelves == 3 + 3 + 2
        assert result.created_bins == 3 * 4 + 3 * 4 + 2 * 3

        locations = _all_locations(db, wh.id)
        by_type = {}
        for loc in locations:
            by_type.setdefault(loc.type, []).append(loc)
        assert len(by_type["zone"]) == 1
        assert len(by_type["aisle"]) == 2
        assert len(by_type["rack"]) == 3
        assert len(by_type["bin"]) == result.created_bins

        # Every non-zone node has a parent and its code extends the parent's code.
        by_id = {loc.id: loc for loc in locations}
        for loc in locations:
            if loc.type == "zone":
                assert loc.parent_id is None
            else:
                parent = by_id[loc.parent_id]
                assert loc.code.startswith(parent.code + "-")

    def test_codes_unique_and_well_formed(self, db, org_factory, warehouse_factory):
        org = org_factory()
        wh = warehouse_factory(org)
        layout_builder.generate_layout(db, org.id, wh.id, _request())
        codes = [loc.code for loc in _all_locations(db, wh.id)]
        assert len(codes) == len(set(codes)), "codes must be unique per warehouse"
        for code in codes:
            assert CODE_RX.match(code), f"malformed code: {code}"

    def test_rerun_offsets_zone_never_collides(self, db, org_factory, warehouse_factory):
        org = org_factory()
        wh = warehouse_factory(org)
        first = layout_builder.generate_layout(db, org.id, wh.id, _request())
        second = layout_builder.generate_layout(db, org.id, wh.id, _request())
        assert first.zone_code == "Z1"
        assert second.zone_code == "Z2"
        codes = [loc.code for loc in _all_locations(db, wh.id)]
        assert len(codes) == len(set(codes))

    def test_positions_and_dims_consistent(self, db, org_factory, warehouse_factory):
        org = org_factory()
        wh = warehouse_factory(org)
        cell = 0.5
        rack = RackPlacement(
            col=4, row=6, w_cells=8, d_cells=2,
            shelf_count=3, bins_per_shelf=4, shelf_height=1.5, bin_capacity=100,
        )
        layout_builder.generate_layout(
            db, org.id, wh.id, LayoutGenerateRequest(cell_size=cell, racks=[rack])
        )
        locations = _all_locations(db, wh.id)
        rack_loc = next(loc for loc in locations if loc.type == "rack")
        assert rack_loc.pos_x == pytest.approx(4 * cell)
        assert rack_loc.pos_y == pytest.approx(6 * cell)
        assert rack_loc.dim_w == pytest.approx(8 * cell)
        assert rack_loc.dim_d == pytest.approx(2 * cell)
        assert rack_loc.dim_h == pytest.approx(3 * 1.5)

        shelves = sorted(
            (loc for loc in locations if loc.type == "shelf"), key=lambda s: s.pos_z
        )
        assert [s.pos_z for s in shelves] == pytest.approx([0.0, 1.5, 3.0])

        bins = [loc for loc in locations if loc.type == "bin"]
        bin_w = rack_loc.dim_w / 4
        for b in bins:
            assert b.dim_w == pytest.approx(bin_w)
            assert rack_loc.pos_x - 1e-6 <= b.pos_x <= rack_loc.pos_x + rack_loc.dim_w + 1e-6
            assert b.capacity == 100

        # Shelf 2's bins sit at shelf 2's height.
        s2 = shelves[1]
        s2_bins = [b for b in bins if b.parent_id == s2.id]
        assert len(s2_bins) == 4
        for b in s2_bins:
            assert b.pos_z == pytest.approx(1.5)

    def test_rack_outside_warehouse_rejected(self, db, org_factory, warehouse_factory):
        org = org_factory()
        wh = warehouse_factory(org, width=10, depth=10)
        oversized = RackPlacement(
            col=0, row=0, w_cells=100, d_cells=2,
            shelf_count=1, bins_per_shelf=1, shelf_height=1.0,
        )
        with pytest.raises(ValidationFailedError):
            layout_builder.generate_layout(
                db, org.id, wh.id, LayoutGenerateRequest(cell_size=0.5, racks=[oversized])
            )

    def test_generate_via_api(
        self, client, auth_headers, org_factory, user_factory, warehouse_factory
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org)
        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/layout/generate",
            json={
                "cell_size": 0.5,
                "racks": [
                    {
                        "col": 2, "row": 2, "w_cells": 8, "d_cells": 2,
                        "shelf_count": 3, "bins_per_shelf": 4,
                        "shelf_height": 1.5, "bin_capacity": 100,
                    }
                ],
            },
            headers=auth_headers(user),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_bins"] == 12
        assert data["sample_codes"][0].startswith("Z1-A1-R1-S1-B")

        layout = client.get(
            f"/api/v1/warehouses/{wh.id}/layout-3d", headers=auth_headers(user)
        ).json()
        assert len(layout["bins"]) == 12
        assert layout["local_width"] == wh.local_width
        # Shelves ship with the payload so the 3D rack skeleton can use real levels.
        assert len(layout["shelves"]) == 3
        shelf_heights = sorted(s["pos_z"] for s in layout["shelves"])
        assert shelf_heights == [0.0, 1.5, 3.0]

import io

import ezdxf
import pytest

from app.core.errors import ValidationFailedError
from app.services import dxf_import


def _make_dxf(
    *, insunits: int = 6, racks: int = 3, add_zone: bool = True, add_walls: bool = True
) -> bytes:
    """Author a synthetic floor plan with ezdxf itself (meters by default)."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = insunits
    for layer in ("RACK", "AISLE", "ZONE", "WALL"):
        doc.layers.add(layer)
    msp = doc.modelspace()

    for i in range(racks):
        x = 2.0 + i * 6.0
        # 4m x 1.2m closed rack rectangle
        msp.add_lwpolyline(
            [(x, 2.0), (x + 4.0, 2.0), (x + 4.0, 3.2), (x, 3.2)],
            close=True,
            dxfattribs={"layer": "RACK"},
        )
    if add_zone:
        msp.add_lwpolyline(
            [(1.0, 1.0), (21.0, 1.0), (21.0, 6.0), (1.0, 6.0)],
            close=True,
            dxfattribs={"layer": "ZONE"},
        )
    if add_walls:
        msp.add_line((0, 0), (22, 0), dxfattribs={"layer": "WALL"})
        msp.add_line((22, 0), (22, 8), dxfattribs={"layer": "WALL"})

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


class TestDxfParse:
    def test_parses_expected_rack_count_and_dims(self):
        preview = dxf_import.parse_dxf(_make_dxf(racks=3))
        assert len(preview.racks) == 3
        assert len(preview.zones) == 1
        assert len(preview.walls) == 2
        for rack in preview.racks:
            assert rack.w == pytest.approx(4.0)
            assert rack.d == pytest.approx(1.2)

    def test_millimeter_units_scaled_to_meters(self):
        doc_bytes = _make_dxf(insunits=4, racks=1, add_zone=False, add_walls=False)
        # Coordinates were authored as "meters" but header says mm → ÷1000.
        preview = dxf_import.parse_dxf(doc_bytes)
        assert preview.scale_applied == pytest.approx(0.001)
        assert preview.racks[0].w == pytest.approx(0.004)

    def test_no_expected_layers_gives_clear_error(self):
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        msp.add_line((0, 0), (5, 5))  # layer "0"
        buf = io.StringIO()
        doc.write(buf)
        with pytest.raises(ValidationFailedError) as exc:
            dxf_import.parse_dxf(buf.getvalue().encode("utf-8"))
        assert "katman" in exc.value.message.lower()

    def test_garbage_bytes_gives_clear_error(self):
        with pytest.raises(ValidationFailedError):
            dxf_import.parse_dxf(b"this is definitely not a dxf file")

    def test_open_rack_polyline_skipped_with_warning(self):
        doc = ezdxf.new("R2010")
        doc.layers.add("RACK")
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (4, 0), (4, 1.2), (0, 1.2)], close=True, dxfattribs={"layer": "RACK"}
        )
        msp.add_lwpolyline(
            [(10, 0), (14, 0), (14, 1.2)], close=False, dxfattribs={"layer": "RACK"}
        )
        buf = io.StringIO()
        doc.write(buf)
        preview = dxf_import.parse_dxf(buf.getvalue().encode("utf-8"))
        assert len(preview.racks) == 1
        assert any("kapalı" in w for w in preview.warnings)


class TestDxfApi:
    def test_parse_then_generate_produces_layout(
        self, client, auth_headers, org_factory, user_factory, warehouse_factory
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org, width=60, depth=40)
        headers = auth_headers(user)

        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/dxf/parse",
            files={"file": ("plan.dxf", _make_dxf(racks=3), "application/dxf")},
            headers=headers,
        )
        assert resp.status_code == 200
        preview = resp.json()
        assert len(preview["racks"]) == 3

        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/dxf/generate",
            json={
                "preview": preview,
                "shelf_count": 3,
                "bins_per_shelf": 4,
                "shelf_height": 1.5,
                "bin_capacity": 100,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        result = resp.json()
        assert result["created_racks"] == 3
        assert result["created_bins"] == 3 * 3 * 4  # racks × shelves × bins

        layout = client.get(f"/api/v1/warehouses/{wh.id}/layout-3d", headers=headers).json()
        assert len(layout["bins"]) == 36
        # Rack geometry survives the import round-trip (~1 cm tolerance).
        rack_dims = sorted((r["dim_w"], r["dim_d"]) for r in layout["racks"])
        for w, d in rack_dims:
            assert w == pytest.approx(4.0, abs=0.02)
            assert d == pytest.approx(1.2, abs=0.02)

    def test_dwg_rejected_with_guidance(
        self, client, auth_headers, org_factory, user_factory, warehouse_factory
    ):
        org = org_factory()
        user = user_factory(org)
        wh = warehouse_factory(org)
        resp = client.post(
            f"/api/v1/warehouses/{wh.id}/dxf/parse",
            files={"file": ("plan.dwg", b"AC1027 fake dwg bytes", "application/acad")},
            headers=auth_headers(user),
        )
        assert resp.status_code == 422
        assert "DWG" in resp.json()["error"]["message"]

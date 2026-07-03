from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import ValidationFailedError
from app.models import User
from app.schemas.dxf import DxfGenerateRequest, DxfGenerateResult, DxfPreview
from app.schemas.location import LayoutGenerateRequest, RackPlacement
from app.services import dxf_import, layout_builder

router = APIRouter(prefix="/warehouses/{warehouse_id}/dxf", tags=["dxf"])

# Fine grid so meter-based DXF rects survive the cell conversion with ~1cm error.
_DXF_CELL = 0.01


@router.post("/parse", response_model=DxfPreview)
def parse(
    warehouse_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
) -> DxfPreview:
    if file.filename and file.filename.lower().endswith(".dwg"):
        raise ValidationFailedError(
            "DWG desteklenmez. Dosyayı önce DXF'e çevirin (ör. ODA File Converter, "
            "AutoCAD 'SAVEAS' → DXF)."
        )
    return dxf_import.parse_dxf(file.file.read())


@router.post("/generate", response_model=DxfGenerateResult, status_code=201)
def generate(
    warehouse_id: int,
    payload: DxfGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DxfGenerateResult:
    """Turn the confirmed DXF preview into storage_locations via the layout builder
    (single code path for hierarchy generation)."""
    racks = [
        RackPlacement(
            col=round(rect.x / _DXF_CELL),
            row=round(rect.y / _DXF_CELL),
            w_cells=max(1, round(rect.w / _DXF_CELL)),
            d_cells=max(1, round(rect.d / _DXF_CELL)),
            rotation=rect.rotation,
            shelf_count=payload.shelf_count,
            bins_per_shelf=payload.bins_per_shelf,
            shelf_height=payload.shelf_height,
            bin_capacity=payload.bin_capacity,
        )
        for rect in payload.preview.racks
    ]
    if not racks:
        raise ValidationFailedError("Önizlemede raf yok; önce bir DXF yükleyin.")
    result = layout_builder.generate_layout(
        db,
        user.org_id,
        warehouse_id,
        LayoutGenerateRequest(
            zone_label=payload.zone_label,
            cell_size=_DXF_CELL,
            racks=racks,
        ),
    )
    return DxfGenerateResult(**result.model_dump())

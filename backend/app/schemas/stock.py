from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReceiveRequest(BaseModel):
    product_id: int
    location_id: int
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class PickRequest(BaseModel):
    product_id: int
    location_id: int
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class TransferRequest(BaseModel):
    product_id: int
    from_location_id: int
    to_location_id: int
    quantity: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class AdjustRequest(BaseModel):
    product_id: int
    location_id: int
    new_quantity: int = Field(ge=0)
    type: Literal["adjust", "count"] = "adjust"
    note: str | None = Field(default=None, max_length=500)


class StockItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    location_id: int
    quantity: int
    updated_at: datetime


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    from_location_id: int | None
    to_location_id: int | None
    type: str
    quantity: int
    user_id: int
    note: str | None
    created_at: datetime


class MovementDetailOut(MovementOut):
    product_sku: str
    product_name: str
    from_code: str | None = None
    to_code: str | None = None
    user_email: str | None = None


class ProductLocationOut(BaseModel):
    """Where a product physically is: bin + warehouse context."""

    location_id: int
    code: str
    warehouse_id: int
    warehouse_name: str
    quantity: int

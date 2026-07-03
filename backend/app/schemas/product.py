from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    unit: str = Field(default="adet", max_length=20)
    barcode: str | None = Field(default=None, max_length=64)
    dim_w: float | None = Field(default=None, ge=0)
    dim_d: float | None = Field(default=None, ge=0)
    dim_h: float | None = Field(default=None, ge=0)
    min_stock_threshold: int = Field(default=0, ge=0)
    image_url: str | None = Field(default=None, max_length=1000)


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    unit: str | None = Field(default=None, max_length=20)
    barcode: str | None = Field(default=None, max_length=64)
    dim_w: float | None = Field(default=None, ge=0)
    dim_d: float | None = Field(default=None, ge=0)
    dim_h: float | None = Field(default=None, ge=0)
    min_stock_threshold: int | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=1000)


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str
    description: str | None
    unit: str
    barcode: str | None
    dim_w: float | None
    dim_d: float | None
    dim_h: float | None
    min_stock_threshold: int
    image_url: str | None
    created_at: datetime


class ProductWithStockOut(ProductOut):
    total_quantity: int = 0
    is_low_stock: bool = False


class CsvImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str]

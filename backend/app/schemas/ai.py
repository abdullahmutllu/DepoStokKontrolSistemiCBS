from typing import Any

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


class AskResponse(BaseModel):
    ai_available: bool
    question: str
    interpretation: str | None = None
    columns: list[str] = []
    rows: list[dict[str, Any]] = []
    location_ids: list[int] = []  # bins to highlight in 3D
    error: str | None = None


class SlottingRequest(BaseModel):
    product_id: int
    warehouse_id: int


class SlottingSuggestion(BaseModel):
    location_id: int
    code: str
    score: float
    reason: str


class SlottingResponse(BaseModel):
    ai_available: bool
    suggestions: list[SlottingSuggestion]
    explanation: str


class SummaryResponse(BaseModel):
    ai_available: bool
    summary: str
    anomalies: list[str] = []

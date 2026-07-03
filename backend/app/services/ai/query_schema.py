"""Constrained query schema — the ONLY thing the AI may produce.

The model returns JSON matching AiQueryEnvelope. `extra="forbid"` everywhere:
any stray key (e.g. "sql") fails validation and the request degrades gracefully.
Raw model output never reaches the database.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Entity = Literal["stock", "movements", "products", "locations"]
FilterOp = Literal["eq", "neq", "lt", "lte", "gt", "gte", "contains", "in"]
AggFn = Literal["sum", "count", "avg"]
SortDir = Literal["asc", "desc"]

FilterValue = str | int | float | bool | list[str] | list[int] | list[float]


class QueryFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    op: FilterOp
    value: FilterValue


class Aggregation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fn: AggFn
    field: str


class Sort(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    dir: SortDir = "asc"


class StructuredQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity: Entity
    filters: list[QueryFilter] = Field(default_factory=list)
    aggregations: list[Aggregation] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    sort: Sort | None = None
    limit: int = 50


class AiQueryEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interpretation: str
    query: StructuredQuery

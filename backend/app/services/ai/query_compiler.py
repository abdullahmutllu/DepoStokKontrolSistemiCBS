"""Compiles a validated StructuredQuery into a parameterized, org-scoped
SQLAlchemy statement.

Safety model: only fields in the per-entity whitelists resolve to columns;
everything else raises UnsupportedQueryError. Every entity's FROM clause is
paired with a mandatory org_id filter applied before the AI's filters, so no
query can cross tenants. There is no code path that executes model-provided
strings as SQL.
"""

from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.core.errors import UnsupportedQueryError
from app.models import Product, StockItem, StockMovement, StorageLocation, Warehouse
from app.services.ai.query_schema import StructuredQuery

MAX_LIMIT = 200

_OPS = {
    "eq": lambda col, v: col == v,
    "neq": lambda col, v: col != v,
    "lt": lambda col, v: col < v,
    "lte": lambda col, v: col <= v,
    "gt": lambda col, v: col > v,
    "gte": lambda col, v: col >= v,
    "contains": lambda col, v: col.ilike(f"%{v}%"),
    "in": lambda col, v: col.in_(v if isinstance(v, list) else [v]),
}

_AGG_FNS = {"sum": func.sum, "count": func.count, "avg": func.avg}


@dataclass
class _EntityDef:
    from_clause: Any
    org_filter: ColumnElement[bool]
    fields: dict[str, Any]
    # Columns whose values are storage_location ids (for 3D highlighting).
    location_id_cols: list[Any] = dc_field(default_factory=list)


def _entity_def(entity: str, org_id: int) -> _EntityDef:
    if entity == "stock":
        joined = (
            StockItem.__table__.join(Product, StockItem.product_id == Product.id)
            .join(StorageLocation, StockItem.location_id == StorageLocation.id)
            .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        )
        return _EntityDef(
            from_clause=joined,
            org_filter=Product.org_id == org_id,
            fields={
                "sku": Product.sku,
                "product_name": Product.name,
                "unit": Product.unit,
                "quantity": StockItem.quantity,
                "min_stock_threshold": Product.min_stock_threshold,
                "location_code": StorageLocation.code,
                "location_type": StorageLocation.type,
                "capacity": StorageLocation.capacity,
                "warehouse_name": Warehouse.name,
                "warehouse_id": Warehouse.id,
            },
            location_id_cols=[StockItem.location_id],
        )

    if entity == "movements":
        joined = StockMovement.__table__.join(
            Product, StockMovement.product_id == Product.id
        )
        return _EntityDef(
            from_clause=joined,
            org_filter=StockMovement.org_id == org_id,
            fields={
                "sku": Product.sku,
                "product_name": Product.name,
                "type": StockMovement.type,
                "quantity": StockMovement.quantity,
                "note": StockMovement.note,
                "created_at": StockMovement.created_at,
            },
            location_id_cols=[StockMovement.to_location_id, StockMovement.from_location_id],
        )

    if entity == "products":
        return _EntityDef(
            from_clause=Product.__table__,
            org_filter=Product.org_id == org_id,
            fields={
                "sku": Product.sku,
                "name": Product.name,
                "product_name": Product.name,
                "unit": Product.unit,
                "barcode": Product.barcode,
                "min_stock_threshold": Product.min_stock_threshold,
                "created_at": Product.created_at,
            },
        )

    if entity == "locations":
        joined = StorageLocation.__table__.join(
            Warehouse, StorageLocation.warehouse_id == Warehouse.id
        )
        return _EntityDef(
            from_clause=joined,
            org_filter=Warehouse.org_id == org_id,
            fields={
                "code": StorageLocation.code,
                "location_code": StorageLocation.code,
                "type": StorageLocation.type,
                "location_type": StorageLocation.type,
                "capacity": StorageLocation.capacity,
                "warehouse_name": Warehouse.name,
                "warehouse_id": Warehouse.id,
            },
            location_id_cols=[StorageLocation.id],
        )

    raise UnsupportedQueryError(f"Bilinmeyen varlık: {entity}")


def field_catalog() -> dict[str, list[str]]:
    """Whitelisted fields per entity — used to build the AI system prompt."""
    return {
        entity: sorted(_entity_def(entity, 0).fields.keys())
        for entity in ("stock", "movements", "products", "locations")
    }


def run_structured_query(
    db: Session, org_id: int, query: StructuredQuery
) -> tuple[list[str], list[dict[str, Any]], list[int]]:
    """Execute the constrained query. Returns (columns, rows, highlight location_ids)."""
    entity = _entity_def(query.entity, org_id)

    def col(name: str):
        if name not in entity.fields:
            raise UnsupportedQueryError(
                f"'{name}' alanı desteklenmiyor. İzinli alanlar: "
                f"{', '.join(sorted(entity.fields))}"
            )
        return entity.fields[name]

    where_clauses = [entity.org_filter]
    for f in query.filters:
        if f.op not in _OPS:
            raise UnsupportedQueryError(f"'{f.op}' operatörü desteklenmiyor")
        where_clauses.append(_OPS[f.op](col(f.field), f.value))

    limit = max(1, min(query.limit, MAX_LIMIT))

    if query.aggregations or query.group_by:
        group_cols = [col(g).label(g) for g in query.group_by]
        agg_cols = [
            _AGG_FNS[agg.fn](col(agg.field)).label(f"{agg.fn}_{agg.field}")
            for agg in query.aggregations
        ] or [func.count().label("count")]
        stmt = (
            select(*group_cols, *agg_cols)
            .select_from(entity.from_clause)
            .where(*where_clauses)
        )
        if group_cols:
            stmt = stmt.group_by(*group_cols)
        sort_candidates = {c.key: c for c in [*group_cols, *agg_cols]}
        if query.sort and query.sort.field in sort_candidates:
            sc = sort_candidates[query.sort.field]
            stmt = stmt.order_by(sc.desc() if query.sort.dir == "desc" else sc.asc())
        result = db.execute(stmt.limit(limit))
        columns = list(result.keys())
        rows = [dict(zip(columns, row, strict=False)) for row in result.all()]
        return columns, rows, []

    # Plain listing: whitelisted fields + location-id columns for highlighting.
    field_names = list(entity.fields.keys())
    out_cols = [entity.fields[name].label(name) for name in field_names]
    id_labels = [c.label(f"__loc_{i}") for i, c in enumerate(entity.location_id_cols)]
    stmt = (
        select(*out_cols, *id_labels)
        .select_from(entity.from_clause)
        .where(*where_clauses)
    )
    if query.sort:
        sort_col = col(query.sort.field)
        stmt = stmt.order_by(sort_col.desc() if query.sort.dir == "desc" else sort_col.asc())

    result = db.execute(stmt.limit(limit))
    keys = list(result.keys())
    location_ids: set[int] = set()
    rows = []
    for row in result.all():
        mapping = dict(zip(keys, row, strict=False))
        rows.append({k: mapping[k] for k in field_names})
        for i in range(len(id_labels)):
            value = mapping.get(f"__loc_{i}")
            if isinstance(value, int):
                location_ids.add(value)
    return field_names, rows, sorted(location_ids)

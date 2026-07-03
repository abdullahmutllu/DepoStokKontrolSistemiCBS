"""Placement suggestion: deterministic rule-based scoring; AI only writes the
explanation prose (template fallback when AI is unavailable)."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AIUnavailableError
from app.models import StockItem, StorageLocation
from app.schemas.ai import SlottingResponse, SlottingSuggestion
from app.services.ai import client
from app.services.scoping import get_owned_product, get_owned_warehouse


def suggest_slots(
    db: Session, org_id: int, product_id: int, warehouse_id: int, top_n: int = 5
) -> SlottingResponse:
    product = get_owned_product(db, org_id, product_id)
    warehouse = get_owned_warehouse(db, org_id, warehouse_id)

    rows = db.execute(
        select(
            StorageLocation.id,
            StorageLocation.code,
            StorageLocation.capacity,
            StorageLocation.pos_z,
            func.coalesce(func.sum(StockItem.quantity), 0).label("qty"),
            func.count(StockItem.id)
            .filter(StockItem.product_id == product.id, StockItem.quantity > 0)
            .label("same_product"),
        )
        .outerjoin(StockItem, StockItem.location_id == StorageLocation.id)
        .where(
            StorageLocation.warehouse_id == warehouse.id,
            StorageLocation.type == "bin",
            StorageLocation.capacity.isnot(None),
        )
        .group_by(
            StorageLocation.id, StorageLocation.code, StorageLocation.capacity,
            StorageLocation.pos_z,
        )
    ).all()

    scored: list[SlottingSuggestion] = []
    for r in rows:
        free = (r.capacity or 0) - r.qty
        if free <= 0:
            continue
        emptiness = free / r.capacity  # 0..1, prefer empty bins
        ground_bonus = 0.3 if r.pos_z < 0.1 else 0.0  # ground level = faster access
        adjacency = 0.4 if r.same_product else 0.0  # consolidate same product
        score = round(emptiness + ground_bonus + adjacency, 3)
        reason_parts = [f"%{round(emptiness * 100)} boş"]
        if adjacency:
            reason_parts.append("aynı ürün bu gözde mevcut")
        if ground_bonus:
            reason_parts.append("zemin seviyesi (hızlı erişim)")
        scored.append(
            SlottingSuggestion(
                location_id=r.id, code=r.code, score=score, reason=", ".join(reason_parts)
            )
        )

    scored.sort(key=lambda s: s.score, reverse=True)
    suggestions = scored[:top_n]

    if not suggestions:
        return SlottingResponse(
            ai_available=False,
            suggestions=[],
            explanation=(
                f"'{warehouse.name}' deposunda boş kapasiteli göz yok. Önce yerleşim "
                "oluşturun veya mevcut gözleri boşaltın."
            ),
        )

    fallback = (
        f"{product.sku} için en uygun göz {suggestions[0].code}: {suggestions[0].reason}. "
        "Puanlama boşluk oranı, zemin erişimi ve aynı-ürün yakınlığına göre yapıldı."
    )
    try:
        prose = client.chat_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "Depo yerleştirme asistanısın. Verilen öneri listesini 2-3 cümlelik "
                        "Türkçe bir açıklamayla özetle. Yeni öneri üretme, karar verme."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Ürün: {product.sku} ({product.name}). Öneriler: "
                        + "; ".join(f"{s.code} (puan {s.score}: {s.reason})" for s in suggestions)
                    ),
                },
            ],
            json_mode=False,
        )
        return SlottingResponse(ai_available=True, suggestions=suggestions, explanation=prose)
    except AIUnavailableError:
        return SlottingResponse(ai_available=False, suggestions=suggestions, explanation=fallback)

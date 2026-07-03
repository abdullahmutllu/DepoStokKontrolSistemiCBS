"""Plain-language weekly report summary + anomaly notes; template fallback."""

from sqlalchemy.orm import Session

from app.core.errors import AIUnavailableError
from app.schemas.ai import SummaryResponse
from app.services import report_service
from app.services.ai import client


def _collect_facts(db: Session, org_id: int) -> tuple[str, list[str]]:
    summaries = report_service.warehouse_summaries(db, org_id)
    low = report_service.low_stock(db, org_id)
    top = report_service.top_movers(db, org_id, days=7, limit=5)
    idle = report_service.top_movers(db, org_id, days=30, limit=5, ascending=True)

    lines = []
    for s in summaries:
        lines.append(
            f"Depo '{s.warehouse_name}': {s.bin_count} göz, {s.used_bin_count} dolu, "
            f"toplam {s.total_quantity} adet, doluluk %{s.occupancy_percent}"
        )
    if low:
        low_bits = "; ".join(
            f"{r.sku} ({r.total_quantity}/{r.min_stock_threshold})" for r in low[:10]
        )
        lines.append(f"Düşük stok: {low_bits}")
    if top:
        lines.append(
            "Son 7 günde en hareketli: "
            + "; ".join(f"{r.sku} ({r.movement_count} hareket)" for r in top)
        )

    anomalies: list[str] = []
    for s in summaries:
        if s.bin_count and s.occupancy_percent > 90:
            anomalies.append(
                f"'{s.warehouse_name}' deposu %{s.occupancy_percent} dolulukta — "
                "kapasite sınırına yaklaşıyor."
            )
        if s.bin_count and s.used_bin_count == 0:
            anomalies.append(f"'{s.warehouse_name}' deposunda hiç stok yok.")
    for r in low[:5]:
        anomalies.append(
            f"{r.sku} minimum eşiğin altında ({r.total_quantity}/{r.min_stock_threshold})."
        )
    if idle:
        quiet = [r.sku for r in idle if r.movement_count <= 1]
        if quiet:
            anomalies.append("Son 30 günde neredeyse hareketsiz: " + ", ".join(quiet[:5]))

    return "\n".join(lines), anomalies


def weekly_summary(db: Session, org_id: int) -> SummaryResponse:
    facts, anomalies = _collect_facts(db, org_id)
    if not facts.strip():
        return SummaryResponse(
            ai_available=False,
            summary="Henüz raporlanacak veri yok. Depo ve stok ekledikçe özet burada görünecek.",
            anomalies=[],
        )
    try:
        prose = client.chat_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "Depo yöneticisi için haftalık durum özeti yazıyorsun. Verilen "
                        "gerçeklerin DIŞINA ÇIKMA, tahmin yürütme, karar önerme. 3-5 cümle, "
                        "sade Türkçe."
                    ),
                },
                {"role": "user", "content": facts},
            ],
            json_mode=False,
        )
        return SummaryResponse(ai_available=True, summary=prose, anomalies=anomalies)
    except AIUnavailableError:
        return SummaryResponse(ai_available=False, summary=facts, anomalies=anomalies)

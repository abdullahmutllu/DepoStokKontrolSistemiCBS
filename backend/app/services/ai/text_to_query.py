"""Natural language → StructuredQuery via the AI, with one schema-feedback retry."""

import json
import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.errors import AIUnavailableError, UnsupportedQueryError
from app.schemas.ai import AskResponse
from app.services.ai import client, query_compiler
from app.services.ai.query_schema import AiQueryEnvelope

logger = logging.getLogger("depo.ai")

_SYSTEM_PROMPT_TEMPLATE = """Sen bir depo yönetim sistemi için sorgu çeviricisisin.
Kullanıcının Türkçe veya İngilizce sorusunu aşağıdaki KISITLI JSON şemasına çevir.
SQL YAZMA. Yalnızca şu JSON yapısını döndür:

{{
  "interpretation": "<sorguyu nasıl anladığının tek cümlelik Türkçe özeti>",
  "query": {{
    "entity": "stock" | "movements" | "products" | "locations",
    "filters": [{{"field": "<alan>", "op": "eq|neq|lt|lte|gt|gte|contains|in", "value": <değer>}}],
    "aggregations": [{{"fn": "sum|count|avg", "field": "<alan>"}}],
    "group_by": ["<alan>"],
    "sort": {{"field": "<alan>", "dir": "asc|desc"}} | null,
    "limit": <1-200>
  }}
}}

Varlık başına izinli alanlar:
{catalog}

Kurallar:
- Yalnızca izinli alanları kullan; başka anahtar EKLEME.
- "stoğu X'in altında" → entity=stock, filters=[{{"field":"quantity","op":"lt","value":X}}]
- Koridor/raf/göz kodları "location_code" alanında "contains" ile aranır (ör. 3. koridor → "-A3-").
- Ürün adı/SKU araması → "product_name" veya "sku" üzerinde "contains".
- Toplam/adet soruları → aggregations + group_by.
- Emin olmadığında en makul yorumu seç; interpretation'da belirt.
"""


def _system_prompt() -> str:
    catalog = query_compiler.field_catalog()
    catalog_text = "\n".join(
        f"- {entity}: {', '.join(fields)}" for entity, fields in catalog.items()
    )
    return _SYSTEM_PROMPT_TEMPLATE.format(catalog=catalog_text)


def _parse_envelope(content: str) -> AiQueryEnvelope:
    return AiQueryEnvelope.model_validate(client.extract_json(content))


def answer_question(db: Session, org_id: int, question: str) -> AskResponse:
    messages = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": question},
    ]

    try:
        content = client.chat_completion(messages)
    except AIUnavailableError as exc:
        return AskResponse(ai_available=False, question=question, error=exc.message)

    envelope: AiQueryEnvelope | None = None
    try:
        envelope = _parse_envelope(content)
    except (ValidationError, ValueError, json.JSONDecodeError) as first_error:
        # One retry with the validation error as feedback.
        try:
            retry_content = client.chat_completion(
                messages
                + [
                    {"role": "assistant", "content": content},
                    {
                        "role": "user",
                        "content": (
                            "Yanıtın şemaya uymadı, yalnızca geçerli JSON döndür. Hata: "
                            f"{first_error}"
                        ),
                    },
                ]
            )
            envelope = _parse_envelope(retry_content)
        except (AIUnavailableError, ValidationError, ValueError, json.JSONDecodeError):
            logger.warning(
                "AI produced unusable query JSON; degrading. First error: %s", first_error
            )
            return AskResponse(
                ai_available=False,
                question=question,
                error="AI sorunuzu güvenli bir sorguya çeviremedi. Daha basit ifade edin.",
            )

    try:
        columns, rows, location_ids = query_compiler.run_structured_query(
            db, org_id, envelope.query
        )
    except UnsupportedQueryError as exc:
        return AskResponse(
            ai_available=True,
            question=question,
            interpretation=envelope.interpretation,
            error=exc.message,
        )

    return AskResponse(
        ai_available=True,
        question=question,
        interpretation=envelope.interpretation,
        columns=columns,
        rows=rows,
        location_ids=location_ids,
    )

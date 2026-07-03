"""text-to-query safety: the AI is fully mocked; these tests prove that raw SQL
from the model is never executed, queries stay org-scoped, and failures degrade
gracefully instead of 500ing."""

import json

import pytest
from sqlalchemy import inspect, select

from app.models import StockItem
from app.services import stock_service
from app.services.ai import client as ai_client


@pytest.fixture
def two_org_env(org_factory, user_factory, warehouse_factory, product_factory, layout_factory):
    """Two orgs with distinct stock so leakage is detectable."""
    env = {}
    for key, qty in (("a", 30), ("b", 99)):
        org = org_factory(f"Org {key.upper()}")
        user = user_factory(org)
        wh = warehouse_factory(org, name=f"Depo {key.upper()}")
        product = product_factory(org, sku=f"SKU-{key.upper()}-001")
        _, bins = layout_factory(org, wh)
        env[key] = dict(org=org, user=user, warehouse=wh, product=product, bins=bins, qty=qty)
    return env


def _fill_stock(db, env):
    for key in ("a", "b"):
        e = env[key]
        stock_service.receive(
            db,
            org_id=e["org"].id,
            user_id=e["user"].id,
            product_id=e["product"].id,
            location_id=e["bins"][0].id,
            quantity=e["qty"],
        )


def _mock_ai(monkeypatch, payload: str):
    calls = {"n": 0}

    def fake_chat(messages, *, json_mode=True):
        calls["n"] += 1
        return payload

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    return calls


class TestTextToQuery:
    def test_valid_query_is_org_scoped(self, db, client, auth_headers, two_org_env, monkeypatch):
        _fill_stock(db, two_org_env)
        _mock_ai(
            monkeypatch,
            json.dumps(
                {
                    "interpretation": "Tüm stok kayıtları",
                    "query": {"entity": "stock", "filters": [], "limit": 100},
                }
            ),
        )
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "tüm stokları göster"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ai_available"] is True
        skus = {row["sku"] for row in data["rows"]}
        assert skus == {"SKU-A-001"}, "must only return caller org's rows"
        quantities = {row["quantity"] for row in data["rows"]}
        assert 99 not in quantities, "org B's stock leaked"
        assert data["location_ids"] == [two_org_env["a"]["bins"][0].id]

    def test_filters_apply(self, db, client, auth_headers, two_org_env, monkeypatch):
        _fill_stock(db, two_org_env)
        _mock_ai(
            monkeypatch,
            json.dumps(
                {
                    "interpretation": "Stoğu 10'un altındaki kayıtlar",
                    "query": {
                        "entity": "stock",
                        "filters": [{"field": "quantity", "op": "lt", "value": 10}],
                        "limit": 50,
                    },
                }
            ),
        )
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "stoğu 10'un altında olanlar"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        assert resp.json()["rows"] == []  # org A has 30 units, nothing under 10

    def test_malicious_sql_key_is_rejected_and_never_executed(
        self, db, client, auth_headers, two_org_env, monkeypatch
    ):
        """Model returns an extra 'sql' key with a DROP TABLE — extra='forbid'
        rejects it on BOTH attempts, and the tables must remain intact."""
        _fill_stock(db, two_org_env)
        _mock_ai(
            monkeypatch,
            json.dumps(
                {
                    "interpretation": "hack",
                    "sql": "DROP TABLE stock_items; DELETE FROM products;--",
                    "query": {"entity": "stock", "filters": [], "limit": 10},
                }
            ),
        )
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "normal görünen bir soru"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200  # graceful degrade, not 500
        data = resp.json()
        assert data["ai_available"] is False
        assert data["rows"] == []

        # Tables intact, data intact.
        assert inspect(db.get_bind()).has_table("stock_items")
        remaining = db.scalars(select(StockItem)).all()
        assert len(remaining) == 2

    def test_sql_string_as_field_name_is_rejected(
        self, db, client, auth_headers, two_org_env, monkeypatch
    ):
        """SQL injected into a whitelisted slot (field name) must hit the
        whitelist wall, not the database."""
        _fill_stock(db, two_org_env)
        _mock_ai(
            monkeypatch,
            json.dumps(
                {
                    "interpretation": "sinsi",
                    "query": {
                        "entity": "stock",
                        "filters": [
                            {
                                "field": "quantity; DROP TABLE stock_items;--",
                                "op": "gt",
                                "value": 0,
                            }
                        ],
                        "limit": 10,
                    },
                }
            ),
        )
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "soru"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ai_available"] is True
        assert data["error"] is not None  # UNSUPPORTED_QUERY_FIELD surfaced
        assert data["rows"] == []
        assert inspect(db.get_bind()).has_table("stock_items")

    def test_broken_json_degrades_gracefully(
        self, db, client, auth_headers, two_org_env, monkeypatch
    ):
        _mock_ai(monkeypatch, "SELECT * FROM stock_items; -- not json at all")
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "soru"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ai_available"] is False
        assert data["error"]

    def test_retry_uses_second_valid_answer(
        self, db, client, auth_headers, two_org_env, monkeypatch
    ):
        _fill_stock(db, two_org_env)
        answers = iter(
            [
                "garbage {{{",
                json.dumps(
                    {
                        "interpretation": "Düzeltilmiş sorgu",
                        "query": {"entity": "stock", "filters": [], "limit": 10},
                    }
                ),
            ]
        )

        def fake_chat(messages, *, json_mode=True):
            return next(answers)

        monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "soru"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ai_available"] is True
        assert len(data["rows"]) == 1

    def test_ai_down_degrades_not_500(self, db, client, auth_headers, two_org_env, monkeypatch):
        from app.core.errors import AIUnavailableError

        def fake_chat(messages, *, json_mode=True):
            raise AIUnavailableError("bağlantı yok")

        monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
        resp = client.post(
            "/api/v1/ai/ask",
            json={"question": "soru"},
            headers=auth_headers(two_org_env["a"]["user"]),
        )
        assert resp.status_code == 200
        assert resp.json()["ai_available"] is False


class TestRateLimit:
    def test_daily_limit_returns_429(
        self, db, client, auth_headers, two_org_env, monkeypatch
    ):
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "ai_daily_limit", 3)
        _mock_ai(
            monkeypatch,
            json.dumps(
                {
                    "interpretation": "ok",
                    "query": {"entity": "products", "filters": [], "limit": 5},
                }
            ),
        )
        headers = auth_headers(two_org_env["a"]["user"])
        for _ in range(3):
            assert (
                client.post("/api/v1/ai/ask", json={"question": "q"}, headers=headers).status_code
                == 200
            )
        resp = client.post("/api/v1/ai/ask", json={"question": "q"}, headers=headers)
        assert resp.status_code == 429
        assert resp.json()["error"]["code"] == "AI_LIMIT_REACHED"

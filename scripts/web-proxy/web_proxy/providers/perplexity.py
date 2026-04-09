"""
providers/perplexity.py — Perplexity.ai webapp provider

Auth: __Secure-next-auth.session-token cookie
Tools: not supported (Perplexity is search-first, not tool-use)
Thinking: not supported
"""

from __future__ import annotations

import json
import uuid
from typing import Iterator

from curl_cffi import requests as cffi_requests

from web_proxy.auth import load_token_file
from web_proxy.base import WebProvider, SSEEvent, TextDelta, Done

PPLX_BASE = "https://www.perplexity.ai"

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)

SUPPORTED_BLOCK_USE_CASES = [
    "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
    "place_widgets", "finance_widgets", "prediction_market_widgets",
    "sports_widgets", "flight_status_widgets", "news_widgets",
    "shopping_widgets", "jobs_widgets", "search_result_widgets",
    "inline_images", "inline_assets", "placeholder_cards", "diff_blocks",
    "inline_knowledge_cards", "entity_group_v2", "refinement_filters",
    "canvas_mode", "maps_preview", "answer_tabs", "price_comparison_widgets",
    "preserve_latex", "generic_onboarding_widgets", "in_context_suggestions",
    "pending_followups", "inline_claims", "unified_assets",
    "workflow_steps", "background_agents",
]

MODEL_MAP = {
    "perplexity": "default",
    "perplexity-sonar": "default",
    "default": "default",
}


class PerplexityProvider(WebProvider):
    name = "perplexity"

    def __init__(self):
        self._token: str = ""

    def handles(self, model: str) -> bool:
        m = model.split("/", 1)[-1] if "/" in model else model
        return m.startswith("perplexity") or m == "default"

    def authenticate(self) -> bool:
        try:
            self._token = load_token_file(
                "perplexity-proxy-token.json", "sessionToken", "PERPLEXITY_SESSION_TOKEN"
            )
            return True
        except Exception:
            return False

    def list_models(self) -> list[dict]:
        return [
            {"id": "web/perplexity", "object": "model", "created": 0, "owned_by": "perplexity"},
            {"id": "web/perplexity-sonar", "object": "model", "created": 0, "owned_by": "perplexity"},
        ]

    def stream(self, messages: list, model: str, tools: list) -> Iterator[SSEEvent]:
        m = model.split("/", 1)[-1] if "/" in model else model
        model_preference = MODEL_MAP.get(m, "default")

        # Extract last user message as query
        query = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, list):
                    content = " ".join(p.get("text", "") for p in content if p.get("type") == "text")
                query = content.strip()
                break

        if not query:
            yield TextDelta(text="[No user message found]")
            yield Done()
            return

        yield from self._stream_query(query, model_preference)

    # ------------------------------------------------------------------
    def _headers(self, frontend_uuid: str) -> dict:
        return {
            "User-Agent": SAFARI_UA,
            "Accept": "text/event-stream",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            "Origin": PPLX_BASE,
            "Referer": f"{PPLX_BASE}/",
            "Cookie": f"__Secure-next-auth.session-token={self._token}",
            "x-app-apiversion": "2.18",
            "x-app-apiclient": "default",
            "x-perplexity-request-reason": "perplexity-query-state-provider",
            "x-perplexity-request-try-number": "1",
            "x-perplexity-request-endpoint": f"{PPLX_BASE}/rest/sse/perplexity_ask",
        }

    def _stream_query(self, query: str, model_preference: str) -> Iterator[SSEEvent]:
        frontend_uuid = str(uuid.uuid4())
        frontend_context_uuid = str(uuid.uuid4())
        payload = {
            "params": {
                "attachments": [],
                "language": "en-US",
                "timezone": "UTC",
                "search_focus": "internet",
                "sources": ["web"],
                "frontend_uuid": frontend_uuid,
                "mode": "copilot",
                "model_preference": model_preference,
                "is_related_query": False,
                "is_sponsored": False,
                "frontend_context_uuid": frontend_context_uuid,
                "prompt_source": "user",
                "query_source": "home",
                "is_incognito": False,
                "time_from_first_type": 500,
                "local_search_enabled": False,
                "use_schematized_api": True,
                "send_back_text_in_streaming_api": True,
                "supported_block_use_cases": SUPPORTED_BLOCK_USE_CASES,
                "client_coordinates": None,
                "mentions": [],
                "dsl_query": query,
                "skip_search_enabled": True,
                "is_nav_suggestions_disabled": False,
                "source": "default",
                "always_search_override": False,
                "override_no_search": False,
                "client_search_results_cache_key": frontend_uuid,
                "should_ask_for_mcp_tool_confirmation": False,
                "browser_agent_allow_once_from_toggle": False,
                "force_enable_browser_agent": False,
                "supported_features": [],
                "extended_context": False,
                "version": "2.18",
            },
            "query_str": query,
        }

        resp = cffi_requests.post(
            f"{PPLX_BASE}/rest/sse/perplexity_ask",
            headers=self._headers(frontend_uuid),
            json=payload,
            impersonate="safari17_0",
            stream=True,
            timeout=120,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Perplexity returned {resp.status_code}: {resp.text[:400]}")

        last_len = 0
        for raw_line in resp.iter_lines():
            if isinstance(raw_line, bytes):
                raw_line = raw_line.decode("utf-8", errors="replace")
            raw_line = raw_line.strip()
            if not raw_line.startswith("data:"):
                continue
            data_str = raw_line[5:].strip()
            if not data_str:
                continue
            try:
                event = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            answer = event.get("answer")
            if answer is not None and len(answer) > last_len:
                yield TextDelta(text=answer[last_len:])
                last_len = len(answer)

            if event.get("text_completed") or event.get("final_sse_message"):
                yield Done()
                return

        yield Done()

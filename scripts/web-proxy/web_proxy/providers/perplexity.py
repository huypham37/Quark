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

    def _raw_stream(self, prompt: str, model: str, **kw):
        # Perplexity uses a stream() override directly (query extraction, not prompt injection)
        raise NotImplementedError

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
        }

    def _stream_query(self, query: str, model_preference: str) -> Iterator[SSEEvent]:
        frontend_uuid = str(uuid.uuid4())
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
                "prompt_source": "user",
                "query_source": "home",
                "is_incognito": False,
                "use_schematized_api": True,
                "send_back_text_in_streaming_api": True,
                "dsl_query": query,
                "source": "default",
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
        using_blocks = False
        saw_text_completed = False
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

            # Legacy format: top-level "answer" field (pre-2025 API)
            if not using_blocks:
                answer = event.get("answer")
                if answer is not None and len(answer) > last_len:
                    yield TextDelta(text=answer[last_len:])
                    last_len = len(answer)

            # New format (2025+): answer in blocks[].markdown_block.chunks
            # Use "ask_text" to avoid duplicates with "ask_text_0_markdown".
            if last_len == 0 or using_blocks:
                for block in event.get("blocks", []):
                    usage = block.get("intended_usage", "")
                    if usage != "ask_text":
                        continue
                    mb = block.get("markdown_block", {})
                    progress = mb.get("progress", "")
                    if progress != "DONE":
                        for chunk in mb.get("chunks", []):
                            if chunk:
                                using_blocks = True
                                yield TextDelta(text=chunk)
                                last_len += len(chunk)

            if event.get("text_completed"):
                saw_text_completed = True

            # Only terminate on final_sse_message (the very last event)
            # or on text_completed AFTER we've already emitted some content.
            # text_completed can fire before blocks arrive, so we can't stop
            # on it alone unless we have content from the legacy "answer" field.
            if event.get("final_sse_message"):
                yield Done()
                return
            if saw_text_completed and last_len > 0 and not using_blocks:
                # Legacy path: got answer text + text_completed
                yield Done()
                return

        yield Done()

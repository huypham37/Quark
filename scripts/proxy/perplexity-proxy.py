#!/usr/bin/env python3
"""
perplexity-proxy.py — OpenAI-compatible proxy to perplexity.ai webapp

Listens on 127.0.0.1:4319, accepts POST /v1/chat/completions,
translates to perplexity.ai SSE API calls using curl_cffi + Safari impersonation.

The last user message is sent as the query. Earlier messages are ignored
(Perplexity manages its own conversation state via thread UUIDs).

Usage:
    python3 scripts/perplexity-proxy.py

Config (env vars):
    PERPLEXITY_PROXY_PORT      Port to listen on (default: 4319)
    PERPLEXITY_SESSION_TOKEN   __Secure-next-auth.session-token cookie value

Token file (fallback):
    ~/.config/atom/perplexity-proxy-token.json
    {"sessionToken": "<value of __Secure-next-auth.session-token>"}

How to get the token:
    1. Open perplexity.ai in Safari
    2. DevTools → Storage → Cookies → www.perplexity.ai
    3. Copy value of __Secure-next-auth.session-token

Dependencies:
    pip install curl_cffi
"""

import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from curl_cffi import requests as cffi_requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PPLX_BASE = "https://www.perplexity.ai"
TOKEN_FILE = Path(os.environ.get("PERPLEXITY_TOKEN_FILE", Path.home() / ".config" / "quark" / "perplexity-proxy-token.json"))

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)

# Capabilities advertised to Perplexity (matches what the browser sends)
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

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def load_session_token() -> str:
    token = os.environ.get("PERPLEXITY_SESSION_TOKEN")
    if token:
        return token
    if TOKEN_FILE.exists():
        try:
            data = json.loads(TOKEN_FILE.read_text())
            if data.get("sessionToken"):
                return data["sessionToken"]
        except Exception:
            pass
    raise RuntimeError(
        "No Perplexity session token found.\n"
        "Set PERPLEXITY_SESSION_TOKEN env var or save to "
        "~/.config/quark/perplexity-proxy-token.json as:\n"
        '  {"sessionToken": "<value of __Secure-next-auth.session-token cookie>"}\n\n'
        "How to get it:\n"
        "  1. Open perplexity.ai in Safari\n"
        "  2. DevTools → Storage → Cookies → www.perplexity.ai\n"
        "  3. Copy value of __Secure-next-auth.session-token"
    )


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _headers(session_token: str, frontend_uuid: str) -> dict:
    return {
        "User-Agent": SAFARI_UA,
        "Accept": "text/event-stream",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "Origin": PPLX_BASE,
        "Referer": f"{PPLX_BASE}/",
        "Cookie": f"__Secure-next-auth.session-token={session_token}",
        "x-app-apiversion": "2.18",
        "x-app-apiclient": "default",
        "x-perplexity-request-reason": "perplexity-query-state-provider",
        "x-perplexity-request-try-number": "1",
        "x-perplexity-request-endpoint": f"{PPLX_BASE}/rest/sse/perplexity_ask",
    }


# ---------------------------------------------------------------------------
# Perplexity SSE call
# ---------------------------------------------------------------------------


def ask_perplexity(query: str, session_token: str, model: str = "default"):
    """
    POST to /rest/sse/perplexity_ask and yield decoded SSE data dicts.

    Each yielded dict is a parsed `data:` JSON payload from the SSE stream.
    """
    frontend_uuid = str(uuid.uuid4())
    frontend_context_uuid = str(uuid.uuid4())

    # Map OpenAI model names → Perplexity model_preference values
    model_map = {
        "perplexity": "default",
        "perplexity-sonar": "default",
        "claude46sonnetthinking": "claude46sonnetthinking",
        "default": "default",
    }
    model_preference = model_map.get(model, "default")

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
            # Set True so text comes back inline in SSE (not via diff_block patches)
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
        headers=_headers(session_token, frontend_uuid),
        json=payload,
        impersonate="safari17_0",
        stream=True,
        timeout=120,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Perplexity returned {resp.status_code}: {resp.text[:400]}"
        )

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
            yield json.loads(data_str)
        except json.JSONDecodeError:
            continue


# ---------------------------------------------------------------------------
# Text extraction from SSE events
# ---------------------------------------------------------------------------


def extract_text_chunk(event: dict) -> str | None:
    """
    Extract answer text from a single SSE event dict.

    Perplexity's current API streams text inside event["text"], which is a
    JSON-encoded array of step objects. The answer lives in the FINAL step's
    "answer" field, which is itself a JSON string containing an "answer" key.

    Returns the accumulated answer text so far, or None if not found.
    """
    # Legacy format: direct "answer" key
    legacy = event.get("answer")
    if legacy:
        return legacy

    # Current format: text is a JSON array of steps
    text_raw = event.get("text")
    if not text_raw or not isinstance(text_raw, str):
        return None

    try:
        steps = json.loads(text_raw)
    except (json.JSONDecodeError, TypeError):
        return None

    # Find the last FINAL step with an answer
    for step in reversed(steps):
        if step.get("step_type") != "FINAL":
            continue
        content = step.get("content", {})
        answer_raw = content.get("answer", "")
        if not answer_raw:
            continue
        try:
            answer_obj = json.loads(answer_raw)
            answer_text = answer_obj.get("answer", "")
            if answer_text:
                # Strip Perplexity citation markers like [1], [2], etc.
                return re.sub(r"\[\d+\]", "", answer_text).strip()
        except (json.JSONDecodeError, TypeError):
            pass

    return None


def is_final(event: dict) -> bool:
    return bool(event.get("text_completed")) or bool(event.get("final_sse_message"))


# ---------------------------------------------------------------------------
# OpenAI SSE chunk builders
# ---------------------------------------------------------------------------


def _make_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"


def _sse_chunk(content: str, model: str, chunk_id: str, finish_reason=None) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"content": content} if content else {},
                "finish_reason": finish_reason,
            }
        ],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


_SSE_DONE = b"data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[perplexity-proxy] {self.address_string()} {fmt % args}")

    # ------------------------------------------------------------------
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "service": "perplexity-proxy"}).encode()
            self._respond(200, "application/json", body)
        elif self.path in ("/v1/models", "/models"):
            body = json.dumps({
                "object": "list",
                "data": [
                    {"id": "perplexity", "object": "model", "created": 0, "owned_by": "perplexity"},
                    {"id": "perplexity-sonar", "object": "model", "created": 0, "owned_by": "perplexity"},
                ],
            }).encode()
            self._respond(200, "application/json", body)
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    # ------------------------------------------------------------------
    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self._respond(404, "application/json", b'{"error":"not found"}')
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception as e:
            return self._error(400, f"Invalid JSON: {e}")

        messages = body.get("messages", [])
        model = body.get("model", "perplexity")
        stream = body.get("stream", False)

        # Strip provider prefix e.g. "perplexity-proxy/perplexity"
        if "/" in model:
            model = model.split("/", 1)[1]

        # Extract the query: last user message
        query = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        p.get("text", "") for p in content if p.get("type") == "text"
                    )
                query = content.strip()
                break

        if not query:
            return self._error(400, "No user message found in messages")

        try:
            session_token = load_session_token()
        except RuntimeError as e:
            return self._error(500, str(e))

        print(f"[perplexity-proxy] Query: {query[:80]!r}")

        if stream:
            self._stream(query, model, session_token)
        else:
            self._collect(query, model, session_token)

    # ------------------------------------------------------------------
    def _stream(self, query: str, model: str, session_token: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        chunk_id = _make_id()
        last_len = 0

        try:
            for event in ask_perplexity(query, session_token, model):
                answer = extract_text_chunk(event)

                if answer is not None and len(answer) > last_len:
                    new_text = answer[last_len:]
                    last_len = len(answer)
                    self.wfile.write(_sse_chunk(new_text, model, chunk_id))
                    self.wfile.flush()

                if is_final(event):
                    self.wfile.write(_sse_chunk("", model, chunk_id, finish_reason="stop"))
                    self.wfile.write(_SSE_DONE)
                    self.wfile.flush()
                    return

            # Stream ended without explicit final marker
            self.wfile.write(_sse_chunk("", model, chunk_id, finish_reason="stop"))
            self.wfile.write(_SSE_DONE)
        except Exception as e:
            print(f"[perplexity-proxy] Stream error: {e}")
            try:
                self.wfile.write(_SSE_DONE)
            except Exception:
                pass
        finally:
            try:
                self.wfile.flush()
            except Exception:
                pass

    # ------------------------------------------------------------------
    def _collect(self, query: str, model: str, session_token: str):
        try:
            full_answer = ""
            last_len = 0

            for event in ask_perplexity(query, session_token, model):
                answer = extract_text_chunk(event)
                if answer is not None and len(answer) > last_len:
                    full_answer = answer
                    last_len = len(answer)
                if is_final(event):
                    break

            resp = {
                "id": _make_id(),
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": full_answer},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            }
            self._respond(200, "application/json", json.dumps(resp).encode())
        except Exception as e:
            self._error(500, str(e))

    # ------------------------------------------------------------------
    def _respond(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, msg: str):
        print(f"[perplexity-proxy] Error {code}: {msg}")
        body = json.dumps({"error": {"message": msg, "type": "proxy_error"}}).encode()
        self._respond(code, "application/json", body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PERPLEXITY_PROXY_PORT", "4319"))
    host = "127.0.0.1"
    print(f"[perplexity-proxy] Starting on http://{host}:{port}")
    print(f"[perplexity-proxy] Endpoint: http://{host}:{port}/v1/chat/completions")
    print(f"[perplexity-proxy] Health:   http://{host}:{port}/health")

    # Validate token on startup
    try:
        token = load_session_token()
        print(f"[perplexity-proxy] Session token loaded: {token[:20]}...")
    except RuntimeError as e:
        print(f"[perplexity-proxy] WARNING: {e}")

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[perplexity-proxy] Shutting down.")
        server.shutdown()

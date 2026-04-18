#!/usr/bin/env python3
"""
meta-proxy.py — OpenAI-compatible proxy to meta.ai webapp

Listens on 127.0.0.1:4320, accepts POST /v1/chat/completions,
translates to meta.ai GraphQL SSE API using cookie-based auth.

Usage:
    python3 scripts/proxy/meta-proxy.py

Config (env vars):
    META_PROXY_PORT   Port to listen on (default: 4320)
    META_RD_CHALLENGE rd_challenge cookie value
    META_ECTO_SESS    ecto_1_sess cookie value (URL-decoded)

Dependencies:
    pip install requests
"""

import json
import os
import time
import uuid
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests as http_requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

META_GRAPHQL = "https://meta.ai/api/graphql"
WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb"
SEND_DOC_ID = "62fbc9b911a73008132a4f5333387703"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)


# ---------------------------------------------------------------------------
# Meta AI session & messaging
# ---------------------------------------------------------------------------


def _unique_message_id() -> str:
    now = int(time.time() * 1000)
    rb = random.getrandbits(22)
    return str(((2199023255551 & now) << 22) | rb)


class MetaSession:
    """Manages cookie-based auth with meta.ai."""

    def __init__(self):
        self.cookies: dict = {}
        self._load_cookies()

    def _load_cookies(self):
        rd = os.environ.get("META_RD_CHALLENGE", "")
        ecto = os.environ.get("META_ECTO_SESS", "")
        if not rd or not ecto:
            raise RuntimeError(
                "Set META_RD_CHALLENGE and META_ECTO_SESS environment variables.\n"
                "Get these from your browser cookies at meta.ai."
            )
        self.cookies = {"rd_challenge": rd, "ecto_1_sess": ecto}

    def warmup(self, conv_id: str):
        """Warm up a conversation."""
        http_requests.post(
            META_GRAPHQL,
            cookies=self.cookies,
            headers={
                "User-Agent": UA,
                "Origin": "https://meta.ai",
                "Content-Type": "application/json",
            },
            json={"doc_id": WARMUP_DOC_ID, "variables": {"conversationId": conv_id}},
            timeout=10,
        )

    def send_message(self, conv_id: str, message: str):
        """
        Send a message via sendMessageStream GraphQL subscription.
        Yields dicts: {"type": "text", "delta": ..., "full": ...}
                      {"type": "thinking", "text": ...}
                      {"type": "thinking_done"}
                      {"type": "done", "full": ...}
        """
        r = http_requests.post(
            META_GRAPHQL,
            cookies=self.cookies,
            headers={
                "User-Agent": UA,
                "Origin": "https://meta.ai",
                "Content-Type": "application/json",
            },
            json={
                "doc_id": SEND_DOC_ID,
                "variables": {
                    "conversationId": conv_id,
                    "content": message,
                    "userMessageId": str(uuid.uuid4()),
                    "assistantMessageId": str(uuid.uuid4()),
                    "userUniqueMessageId": _unique_message_id(),
                    "turnId": str(uuid.uuid4()),
                },
            },
            timeout=120,
        )

        if r.status_code != 200:
            raise RuntimeError(f"Meta AI returned {r.status_code}: {r.text[:400]}")

        # Update cookies from response
        for c in r.cookies:
            self.cookies[c.name] = c.value

        prev_text = ""
        for line in r.text.split("\n"):
            line = line.strip()
            if not line.startswith("data: "):
                continue
            try:
                obj = json.loads(line[6:])
            except json.JSONDecodeError:
                continue

            msg = obj.get("data", {}).get("sendMessageStream", {})
            if msg.get("__typename") != "AssistantMessage":
                continue

            cr = msg.get("contentRenderer", {})
            ur = cr.get("unified_response", {})
            sections = ur.get("sections", [])

            for section in sections:
                prim = section.get("view_model", {}).get("primitive", {})
                tn = prim.get("__typename", "")

                if "ThinkingStatus" in tn:
                    if prim.get("is_in_progress"):
                        thought = prim.get("thought_text") or prim.get("title", "")
                        if thought:
                            yield {"type": "thinking", "text": thought}
                    else:
                        yield {"type": "thinking_done"}

                elif "MarkdownText" in tn:
                    text = prim.get("text", "")
                    if text and text != prev_text:
                        if text.startswith(prev_text):
                            delta = text[len(prev_text):]
                            if delta:
                                yield {"type": "text", "delta": delta, "full": text}
                        else:
                            yield {"type": "text", "delta": text, "full": text}
                        prev_text = text

            if msg.get("streamingState") == "DONE" and prev_text:
                yield {"type": "done", "full": prev_text}
                return


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
# Shared session
# ---------------------------------------------------------------------------

_session: MetaSession | None = None


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[meta-proxy] {self.address_string()} {fmt % args}")

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "service": "meta-proxy"}).encode()
            self._respond(200, "application/json", body)
        elif self.path in ("/v1/models", "/models"):
            body = json.dumps({
                "object": "list",
                "data": [
                    {"id": "meta-ai", "object": "model", "created": 0, "owned_by": "meta"},
                    {"id": "llama", "object": "model", "created": 0, "owned_by": "meta"},
                ],
            }).encode()
            self._respond(200, "application/json", body)
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

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
        model = body.get("model", "meta-ai")
        stream = body.get("stream", False)

        if "/" in model:
            model = model.split("/", 1)[1]

        # Extract last user message
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

        print(f"[meta-proxy] Query: {query[:80]!r}")

        conv_id = str(uuid.uuid4())
        _session.warmup(conv_id)

        if stream:
            self._stream(query, model, conv_id)
        else:
            self._collect(query, model, conv_id)

    def _stream(self, query: str, model: str, conv_id: str):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        chunk_id = _make_id()

        try:
            for event in _session.send_message(conv_id, query):
                if event["type"] == "text":
                    self.wfile.write(_sse_chunk(event["delta"], model, chunk_id))
                    self.wfile.flush()
                elif event["type"] == "done":
                    self.wfile.write(_sse_chunk("", model, chunk_id, finish_reason="stop"))
                    self.wfile.write(_SSE_DONE)
                    self.wfile.flush()
                    return

            # Stream ended without explicit done
            self.wfile.write(_sse_chunk("", model, chunk_id, finish_reason="stop"))
            self.wfile.write(_SSE_DONE)
        except Exception as e:
            print(f"[meta-proxy] Stream error: {e}")
            try:
                self.wfile.write(_SSE_DONE)
            except Exception:
                pass
        finally:
            try:
                self.wfile.flush()
            except Exception:
                pass

    def _collect(self, query: str, model: str, conv_id: str):
        try:
            full_answer = ""
            for event in _session.send_message(conv_id, query):
                if event["type"] in ("text", "done"):
                    full_answer = event.get("full", full_answer)

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

    def _respond(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, msg: str):
        print(f"[meta-proxy] Error {code}: {msg}")
        body = json.dumps({"error": {"message": msg, "type": "proxy_error"}}).encode()
        self._respond(code, "application/json", body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("META_PROXY_PORT", "4320"))
    host = "127.0.0.1"

    print(f"[meta-proxy] Starting on http://{host}:{port}")
    print(f"[meta-proxy] Endpoint: http://{host}:{port}/v1/chat/completions")
    print(f"[meta-proxy] Health:   http://{host}:{port}/health")

    try:
        _session = MetaSession()
        print("[meta-proxy] Cookies loaded. Ready.")
    except RuntimeError as e:
        print(f"[meta-proxy] FATAL: {e}")
        raise SystemExit(1)

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[meta-proxy] Shutting down.")
        server.shutdown()

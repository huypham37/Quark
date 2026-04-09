"""
server.py — Unified HTTP server for all web LLM providers.

Single process, single port (default 4320).
Routes POST /v1/chat/completions by model prefix:
  web/qwen3.6-plus    → QwenProvider
  web/claude-sonnet-4 → ClaudeProvider
  web/perplexity      → PerplexityProvider
  web/meta-ai         → MetaProvider

Providers yield abstract SSEEvents; this server converts them to
OpenAI-compatible SSE bytes using sse.py.

All reasoning tokens (ReasoningDelta) are emitted as delta.reasoning_content
so @ai-sdk/alibaba on the Quark side handles them uniformly.
"""

from __future__ import annotations

import json
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

from web_proxy.base import registry, TextDelta, ReasoningDelta, ToolCall, Done
from web_proxy import sse


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[web-proxy] {self.address_string()} {fmt % args}")

    # ------------------------------------------------------------------
    # GET
    # ------------------------------------------------------------------
    def do_GET(self):
        if self.path == "/health":
            providers = [p.name for p in registry._providers if p.is_ready()]
            body = json.dumps({"ok": True, "providers": providers}).encode()
            self._respond(200, "application/json", body)

        elif self.path in ("/v1/models", "/models"):
            models = registry.all_models()
            body = json.dumps({"object": "list", "data": models}).encode()
            self._respond(200, "application/json", body)

        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    # ------------------------------------------------------------------
    # POST
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
        model: str = body.get("model", "")
        stream: bool = body.get("stream", False)
        tools: list = body.get("tools", [])

        provider = registry.resolve(model)
        if provider is None:
            return self._error(400, f"No provider found for model '{model}'")

        if not provider.is_ready():
            return self._error(503, f"Provider '{provider.name}' is not authenticated")

        # Strip provider prefix for the provider itself
        model_id = model.split("/", 1)[-1] if "/" in model else model

        print(f"[web-proxy] {provider.name} | model={model_id} | tools={len(tools)} | stream={stream}")

        try:
            if stream:
                self._handle_stream(provider, messages, model_id, tools)
            else:
                self._handle_collect(provider, messages, model_id, tools)
        except Exception as e:
            print(f"[web-proxy] Error: {e}")
            self._error(500, str(e))

    # ------------------------------------------------------------------
    def _handle_stream(self, provider, messages, model_id, tools):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        chunk_id = sse.make_id()
        call_index = 0
        saw_tool_call = False

        try:
            for event in provider.stream(messages, model_id, tools):
                if isinstance(event, TextDelta):
                    self.wfile.write(sse.sse_text(event.text, model_id, chunk_id))
                    self.wfile.flush()

                elif isinstance(event, ReasoningDelta):
                    self.wfile.write(sse.sse_reasoning(event.text, model_id, chunk_id))
                    self.wfile.flush()

                elif isinstance(event, ToolCall):
                    saw_tool_call = True
                    call_id = f"call_{uuid.uuid4().hex[:12]}"
                    args_json = json.dumps(event.arguments)
                    self.wfile.write(sse.sse_tool_call_start(model_id, chunk_id, call_index, call_id, event.name))
                    self.wfile.write(sse.sse_tool_call_args(model_id, chunk_id, call_index, args_json))
                    self.wfile.flush()
                    call_index += 1

                elif isinstance(event, Done):
                    finish = "tool_calls" if saw_tool_call else event.finish_reason
                    self.wfile.write(sse.sse_finish(model_id, chunk_id, finish))
                    self.wfile.write(sse.sse_done())
                    self.wfile.flush()
                    return

            # Provider didn't yield Done — emit it anyway
            finish = "tool_calls" if saw_tool_call else "stop"
            self.wfile.write(sse.sse_finish(model_id, chunk_id, finish))
            self.wfile.write(sse.sse_done())

        except Exception as e:
            print(f"[web-proxy] Stream error ({provider.name}): {e}")
            try:
                self.wfile.write(sse.sse_done())
            except Exception:
                pass
        finally:
            try:
                self.wfile.flush()
            except Exception:
                pass

    # ------------------------------------------------------------------
    def _handle_collect(self, provider, messages, model_id, tools):
        chunk_id = sse.make_id()
        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls_out: list[dict] = []
        call_index = 0

        try:
            for event in provider.stream(messages, model_id, tools):
                if isinstance(event, TextDelta):
                    text_parts.append(event.text)
                elif isinstance(event, ReasoningDelta):
                    reasoning_parts.append(event.text)
                elif isinstance(event, ToolCall):
                    call_id = f"call_{uuid.uuid4().hex[:12]}"
                    tool_calls_out.append({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": event.name,
                            "arguments": json.dumps(event.arguments),
                        },
                    })
                    call_index += 1
                elif isinstance(event, Done):
                    break

            resp = sse.non_stream_response(
                model=model_id,
                chunk_id=chunk_id,
                text="".join(text_parts),
                tool_calls=tool_calls_out or None,
                reasoning="".join(reasoning_parts) or None,
            )
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
        print(f"[web-proxy] Error {code}: {msg}")
        body = json.dumps({"error": {"message": msg, "type": "proxy_error"}}).encode()
        self._respond(code, "application/json", body)

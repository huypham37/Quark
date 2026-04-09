#!/usr/bin/env python3
"""
qwen-web-proxy.py — OpenAI-compatible proxy to chat.qwen.ai webapp

Listens on 127.0.0.1:4320, accepts POST /v1/chat/completions,
translates to chat.qwen.ai SSE API calls.

Usage:
    python3 scripts/qwen-web-proxy.py

Config (env vars):
    QWEN_PROXY_PORT           Port to listen on (default: 4320)
    QWEN_AUTH_TOKEN            JWT token from chat.qwen.ai cookies

Token file (fallback):
    ~/.config/atom/qwen-web-proxy-token.json
    {"token": "<value of token cookie from chat.qwen.ai>"}

How to get the token:
    1. Open chat.qwen.ai in your browser
    2. DevTools → Storage → Cookies → chat.qwen.ai
    3. Copy the value of the 'token' cookie (starts with eyJ...)

Dependencies:
    pip install requests
"""

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

QWEN_BASE = "https://chat.qwen.ai"
TOKEN_FILE = Path.home() / ".config" / "quark" / "qwen-web-proxy-token.json"
BROWSER_HEADERS_FILE = Path.home() / ".config" / "quark" / "qwen-web-proxy-browser-headers.json"

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def load_token() -> str:
    token = os.environ.get("QWEN_AUTH_TOKEN")
    if token:
        return token
    if TOKEN_FILE.exists():
        try:
            data = json.loads(TOKEN_FILE.read_text())
            if data.get("token"):
                return data["token"]
        except Exception:
            pass
    raise RuntimeError(
        "No Qwen auth token found.\n"
        "Set QWEN_AUTH_TOKEN env var or save to "
        f"{TOKEN_FILE} as:\n"
        '  {"token": "<value of token cookie from chat.qwen.ai>"}\n\n'
        "How to get it:\n"
        "  1. Open chat.qwen.ai in your browser\n"
        "  2. DevTools → Storage → Cookies → chat.qwen.ai\n"
        "  3. Copy the value of the 'token' cookie (starts with eyJ...)"
    )


def load_browser_headers() -> dict:
    """Load captured browser headers (bx-ua, bx-umidtoken, cookies, etc.)."""
    if BROWSER_HEADERS_FILE.exists():
        try:
            return json.loads(BROWSER_HEADERS_FILE.read_text())
        except Exception:
            pass
    return {}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _headers(token: str) -> dict:
    bh = load_browser_headers()
    hdrs = {
        "User-Agent": SAFARI_UA,
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "Origin": QWEN_BASE,
        "Referer": f"{QWEN_BASE}/c/guest",
        "source": "web",
        "Connection": "keep-alive",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "X-Request-Id": str(uuid.uuid4()),
    }
    # Anti-bot headers from browser capture
    for key in ("bx-umidtoken", "bx-ua", "bx-v", "Version", "Timezone", "Cookie"):
        if key in bh:
            hdrs[key] = bh[key]
    return hdrs


# ---------------------------------------------------------------------------
# Qwen API calls
# ---------------------------------------------------------------------------


def list_qwen_models(token: str) -> list[dict]:
    """Fetch available models from chat.qwen.ai."""
    resp = requests.get(
        f"{QWEN_BASE}/api/models",
        headers=_headers(token),
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"[qwen-proxy] Failed to fetch models: {resp.status_code}")
        return []
    data = resp.json()
    return data.get("data", [])


def create_chat(token: str, model_id: str) -> str:
    """Create a new chat session, return chat_id."""
    payload = {
        "title": "New Chat",
        "models": [model_id],
        "chat_mode": "normal",
        "chat_type": "t2t",
        "timestamp": int(time.time() * 1000),
    }
    resp = requests.post(
        f"{QWEN_BASE}/api/v2/chats/new",
        headers=_headers(token),
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["data"]["id"]


def delete_chat(token: str, chat_id: str):
    """Delete a chat session."""
    try:
        requests.delete(
            f"{QWEN_BASE}/api/v2/chats/{chat_id}",
            headers=_headers(token),
            timeout=10,
        )
    except Exception:
        pass


def stream_chat(token: str, chat_id: str, model_id: str, user_input: str):
    """
    POST to /api/v2/chat/completions and yield parsed SSE dicts.
    Each dict has 'choices' with delta containing phase/content/status.
    """
    ts = int(time.time())

    feature_config = {
        "thinking_enabled": True,
        "output_schema": "phase",
        "research_mode": "normal",
        "auto_thinking": True,
        "thinking_mode": "Auto",
        "thinking_format": "summary",
        "auto_search": False,
    }

    payload = {
        "stream": True,
        "version": "2.1",
        "incremental_output": True,
        "chat_id": chat_id,
        "chat_mode": "normal",
        "model": model_id,
        "parent_id": None,
        "messages": [
            {
                "fid": str(uuid.uuid4()),
                "parentId": None,
                "childrenIds": [str(uuid.uuid4())],
                "role": "user",
                "content": user_input,
                "user_action": "chat",
                "files": [],
                "timestamp": ts,
                "models": [model_id],
                "chat_type": "t2t",
                "feature_config": feature_config,
                "extra": {"meta": {"subChatType": "t2t"}},
                "sub_chat_type": "t2t",
                "parent_id": None,
            }
        ],
        "timestamp": ts,
    }

    # NOTE: Do NOT pass tools in the payload. The Qwen webapp backend
    # intercepts native function_call and tries to execute tools server-side,
    # returning "Tool does not exists." We rely on prompt injection +
    # client-side <tool_call> XML parsing instead.

    hdrs = _headers(token)
    hdrs["Accept"] = "text/event-stream"
    hdrs["x-accel-buffering"] = "no"

    resp = requests.post(
        f"{QWEN_BASE}/api/v2/chat/completions?chat_id={chat_id}",
        headers=hdrs,
        json=payload,
        stream=True,
        timeout=120,
    )

    if resp.status_code != 200:
        raise RuntimeError(
            f"Qwen returned {resp.status_code}: {resp.text[:400]}"
        )

    for raw_line in resp.iter_lines(decode_unicode=True):
        if not raw_line:
            continue
        print(f"[qwen-proxy] RAW: {raw_line[:200]}")
        if not raw_line.startswith("data:"):
            continue
        data_str = raw_line[5:].strip() if raw_line.startswith("data: ") else raw_line[5:].strip()
        if data_str == "[DONE]":
            yield {"done": True}
            return
        try:
            yield json.loads(data_str)
        except json.JSONDecodeError:
            continue


# ---------------------------------------------------------------------------
# OpenAI SSE chunk builders
# ---------------------------------------------------------------------------


def _make_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"


def _sse_chunk(
    content: str,
    model: str,
    chunk_id: str,
    finish_reason=None,
    reasoning_content: str | None = None,
) -> bytes:
    delta = {}
    if content:
        delta["content"] = content
    if reasoning_content:
        delta["reasoning_content"] = reasoning_content
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


_SSE_DONE = b"data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Model mapping
# ---------------------------------------------------------------------------

MODEL_MAP = {
    "qwen": "qwen3-max",
    "qwen3": "qwen3-max",
    "qwen3-coder": "qwen3-coder-plus",
    "qwen-max": "qwen-max-latest",
    "qwq": "qwq-32b",
}

# Cache of known models from the API
_known_models: set[str] = set()


def resolve_model(model: str) -> str:
    """Resolve model name to Qwen model ID."""
    # Strip provider prefix
    if "/" in model:
        model = model.split("/", 1)[1]
    # Check mapping first
    if model in MODEL_MAP:
        return MODEL_MAP[model]
    # If it's a known model ID, use directly
    if model in _known_models:
        return model
    # Default
    return model


# ---------------------------------------------------------------------------
# Tool schema injection into prompt
# ---------------------------------------------------------------------------

TOOL_SYSTEM_PREAMBLE = """You have access to the following tools. When you need to use a tool, output a tool call block in this exact format (one per tool call):

<tool_call>
{"name": "tool_name", "arguments": {"arg1": "value1"}}
</tool_call>

You may output text before or between tool calls, but each tool call MUST be wrapped in <tool_call></tool_call> tags with valid JSON inside.

When you want to call a tool, ALWAYS use the <tool_call> tags. Never describe what you would do — just call the tool directly.

Available tools:
"""


def build_tool_preamble(tools: list) -> str:
    if not tools:
        return ""
    lines = [TOOL_SYSTEM_PREAMBLE]
    for t in tools:
        if isinstance(t, dict) and t.get("type") == "function":
            fn = t.get("function", {})
        elif isinstance(t, dict) and "name" in t:
            fn = t
        else:
            continue
        name = fn.get("name", "unknown")
        desc = fn.get("description", "")
        params = fn.get("parameters", fn.get("input_schema", {}))
        lines.append(f"### {name}")
        if desc:
            lines.append(desc)
        if params:
            lines.append(f"Parameters: {json.dumps(params)}")
        lines.append("")
    return "\n".join(lines)


def messages_to_prompt(messages: list, tools: list | None = None) -> str:
    """Serialise OpenAI messages (including tool history) into a flat prompt string."""
    tool_preamble = build_tool_preamble(tools) if tools else ""
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            content = " ".join(
                p.get("text", "") for p in content if p.get("type") == "text"
            )

        if role == "system":
            sys_text = content
            if tool_preamble:
                sys_text = tool_preamble + "\n\n" + content
                tool_preamble = ""
            parts.append(f"system: {sys_text}")
        elif role == "user":
            parts.append(f"user: {content}")
        elif role == "assistant":
            tool_calls = msg.get("tool_calls", [])
            if tool_calls:
                tc_text = content or ""
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    tc_text += "\n<tool_call>\n"
                    tc_text += json.dumps({
                        "name": fn.get("name", ""),
                        "arguments": json.loads(fn.get("arguments", "{}")),
                    })
                    tc_text += "\n</tool_call>"
                parts.append(f"assistant: {tc_text}")
            else:
                parts.append(f"assistant: {content}")
        elif role == "tool":
            tool_call_id = msg.get("tool_call_id", "")
            parts.append(f'tool_result [{tool_call_id}]: {content}')

    if tool_preamble:
        parts.insert(0, f"system: {tool_preamble}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Tool call parser — detect <tool_call>...</tool_call> in streamed text
# ---------------------------------------------------------------------------

TOOL_CALL_OPEN = "<tool_call>"
TOOL_CALL_CLOSE = "</tool_call>"


class ToolCallParser:
    """
    Accumulates streamed text and detects <tool_call>...</tool_call> blocks.
    Emits events:
      ("text", str)       — normal text content
      ("tool_call", dict) — parsed tool call {"name":..., "arguments":...}
    """

    def __init__(self):
        self._buf = ""
        self._in_tag = False
        self._tag_buf = ""

    def feed(self, text: str):
        self._buf += text
        while True:
            if not self._in_tag:
                idx = self._buf.find(TOOL_CALL_OPEN)
                if idx == -1:
                    safe = len(self._buf) - len(TOOL_CALL_OPEN)
                    if safe > 0:
                        yield ("text", self._buf[:safe])
                        self._buf = self._buf[safe:]
                    break
                else:
                    if idx > 0:
                        yield ("text", self._buf[:idx])
                    self._buf = self._buf[idx + len(TOOL_CALL_OPEN):]
                    self._in_tag = True
                    self._tag_buf = ""
            else:
                idx = self._buf.find(TOOL_CALL_CLOSE)
                if idx == -1:
                    self._tag_buf += self._buf
                    self._buf = ""
                    break
                else:
                    self._tag_buf += self._buf[:idx]
                    self._buf = self._buf[idx + len(TOOL_CALL_CLOSE):]
                    self._in_tag = False
                    try:
                        obj = json.loads(self._tag_buf.strip())
                        yield ("tool_call", obj)
                    except json.JSONDecodeError:
                        yield ("text", TOOL_CALL_OPEN + self._tag_buf + TOOL_CALL_CLOSE)
                    self._tag_buf = ""

    def flush(self):
        remaining = self._buf
        if self._in_tag:
            remaining = TOOL_CALL_OPEN + self._tag_buf + remaining
        if remaining:
            yield ("text", remaining)
        self._buf = ""
        self._tag_buf = ""
        self._in_tag = False


# ---------------------------------------------------------------------------
# Synthetic OpenAI tool_calls SSE chunk builders
# ---------------------------------------------------------------------------


def _sse_tool_call_start(
    model: str, chunk_id: str, call_index: int, call_id: str, name: str
) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {
                "tool_calls": [{
                    "index": call_index,
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": ""},
                }]
            },
            "finish_reason": None,
        }],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def _sse_tool_call_args(
    model: str, chunk_id: str, call_index: int, args_json: str
) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {
                "tool_calls": [{
                    "index": call_index,
                    "function": {"arguments": args_json},
                }]
            },
            "finish_reason": None,
        }],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[qwen-proxy] {self.address_string()} {fmt % args}")

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "service": "qwen-web-proxy"}).encode()
            self._respond(200, "application/json", body)
        elif self.path in ("/v1/models", "/models"):
            try:
                token = load_token()
                raw_models = list_qwen_models(token)
                models = []
                for m in raw_models:
                    mid = m.get("id", m.get("info", {}).get("id", "unknown"))
                    _known_models.add(mid)
                    models.append(
                        {
                            "id": mid,
                            "object": "model",
                            "created": m.get("created", 0),
                            "owned_by": m.get("owned_by", "qwen"),
                        }
                    )
                body = json.dumps({"object": "list", "data": models}).encode()
                self._respond(200, "application/json", body)
            except Exception as e:
                self._error(500, str(e))
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
        model = body.get("model", "qwen3")
        stream = body.get("stream", False)
        tools = body.get("tools", [])

        model_id = resolve_model(model)

        # Inject tools into prompt text — Qwen webapp recognises them and
        # responds with native delta.function_call JSON
        user_input = messages_to_prompt(messages, tools if tools else None)

        if not user_input.strip():
            return self._error(400, "No message content found")

        try:
            token = load_token()
        except RuntimeError as e:
            return self._error(500, str(e))

        has_tools = bool(tools)
        print(f"[qwen-proxy] Model: {model_id} | Tools: {len(tools)} | Query: {user_input[:80]!r}")

        if stream:
            self._stream(user_input, model, model_id, token, has_tools)
        else:
            self._collect(user_input, model, model_id, token, has_tools)

    def _stream(self, user_input: str, model: str, model_id: str, token: str, has_tools: bool = False):
        chat_id = None
        try:
            chat_id = create_chat(token, model_id)
        except Exception as e:
            return self._error(500, f"Failed to create chat: {e}")

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        chunk_id = _make_id()
        parser = ToolCallParser() if has_tools else None
        call_index = 0
        saw_tool_call = False
        # Track native function_call accumulation (Qwen streams args incrementally)
        active_fc_name = None
        active_fc_args = ""

        try:
            for event in stream_chat(token, chat_id, model_id, user_input):
                if event.get("done"):
                    break

                choices = event.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                phase = delta.get("phase")
                status = delta.get("status")
                content = delta.get("content", "")
                fc = delta.get("function_call")
                reasoning = delta.get("reasoning_content", "")
                finish = choices[0].get("finish_reason")

                # --- Native function_call from Qwen API (qwen3.6-plus) ---
                if fc and has_tools:
                    fc_name = fc.get("name", "")
                    fc_args = fc.get("arguments", "")

                    if fc_name and fc_name != active_fc_name:
                        # Flush previous function_call if any
                        if active_fc_name is not None:
                            call_id = f"call_{uuid.uuid4().hex[:12]}"
                            self.wfile.write(_sse_tool_call_start(model, chunk_id, call_index, call_id, active_fc_name))
                            self.wfile.write(_sse_tool_call_args(model, chunk_id, call_index, active_fc_args))
                            self.wfile.flush()
                            call_index += 1
                        # Start new function_call
                        active_fc_name = fc_name
                        active_fc_args = fc_args
                        saw_tool_call = True
                    elif active_fc_name is not None:
                        # Accumulate incremental args (Qwen sends full args each time)
                        active_fc_args = fc_args
                    continue

                # --- Reasoning content (qwen3-coder-plus sends delta.reasoning_content) ---
                if reasoning:
                    self.wfile.write(_sse_chunk("", model, chunk_id, reasoning_content=reasoning))
                    self.wfile.flush()

                # --- Phase-based thinking (qwen3.6-plus) ---
                if phase == "think" and status != "finished" and content:
                    self.wfile.write(_sse_chunk("", model, chunk_id, reasoning_content=content))
                    self.wfile.flush()
                    continue
                elif phase == "thinking_summary" and status != "finished":
                    continue

                # --- Text content (both models) ---
                # For phase-based: phase=="answer" or phase is None
                # For non-phase: content is present directly
                if phase == "answer" or (phase is None and content):
                    # Flush any pending native function_call before text
                    if active_fc_name is not None:
                        call_id = f"call_{uuid.uuid4().hex[:12]}"
                        self.wfile.write(_sse_tool_call_start(model, chunk_id, call_index, call_id, active_fc_name))
                        self.wfile.write(_sse_tool_call_args(model, chunk_id, call_index, active_fc_args))
                        self.wfile.flush()
                        call_index += 1
                        active_fc_name = None
                        active_fc_args = ""

                    if parser and content:
                        for kind, value in parser.feed(content):
                            if kind == "text" and value:
                                self.wfile.write(_sse_chunk(value, model, chunk_id))
                                self.wfile.flush()
                            elif kind == "tool_call":
                                saw_tool_call = True
                                call_id = f"call_{uuid.uuid4().hex[:12]}"
                                name = value.get("name", "")
                                args = json.dumps(value.get("arguments", {}))
                                self.wfile.write(_sse_tool_call_start(model, chunk_id, call_index, call_id, name))
                                self.wfile.write(_sse_tool_call_args(model, chunk_id, call_index, args))
                                self.wfile.flush()
                                call_index += 1
                    elif content:
                        self.wfile.write(_sse_chunk(content, model, chunk_id))
                        self.wfile.flush()

                # --- Stream finished ---
                is_done = (status == "finished" and phase == "answer") or finish == "stop"
                if is_done:
                    # Flush any pending native function_call
                    if active_fc_name is not None:
                        call_id = f"call_{uuid.uuid4().hex[:12]}"
                        self.wfile.write(_sse_tool_call_start(model, chunk_id, call_index, call_id, active_fc_name))
                        self.wfile.write(_sse_tool_call_args(model, chunk_id, call_index, active_fc_args))
                        self.wfile.flush()
                        call_index += 1
                        active_fc_name = None
                        active_fc_args = ""

                    # Flush XML parser remainder
                    if parser:
                        for kind, value in parser.flush():
                            if kind == "text" and value:
                                self.wfile.write(_sse_chunk(value, model, chunk_id))
                                self.wfile.flush()
                            elif kind == "tool_call":
                                saw_tool_call = True
                                call_id = f"call_{uuid.uuid4().hex[:12]}"
                                name = value.get("name", "")
                                args = json.dumps(value.get("arguments", {}))
                                self.wfile.write(_sse_tool_call_start(model, chunk_id, call_index, call_id, name))
                                self.wfile.write(_sse_tool_call_args(model, chunk_id, call_index, args))
                                self.wfile.flush()
                                call_index += 1

                    finish_reason = "tool_calls" if saw_tool_call else "stop"
                    self.wfile.write(_sse_chunk("", model, chunk_id, finish_reason=finish_reason))
                    self.wfile.write(_SSE_DONE)
                    self.wfile.flush()
                    break

        except Exception as e:
            print(f"[qwen-proxy] Stream error: {e}")
            try:
                self.wfile.write(_SSE_DONE)
            except Exception:
                pass
        finally:
            try:
                self.wfile.flush()
            except Exception:
                pass
            if chat_id:
                delete_chat(token, chat_id)

    def _collect(self, user_input: str, model: str, model_id: str, token: str, has_tools: bool = False):
        chat_id = None
        try:
            chat_id = create_chat(token, model_id)
            full_answer = ""
            reasoning = ""

            for event in stream_chat(token, chat_id, model_id, user_input):
                if event.get("done"):
                    break
                choices = event.get("choices", [])
                if not choices:
                    continue
                delta = choices[0].get("delta", {})
                phase = delta.get("phase")
                status = delta.get("status")
                content = delta.get("content", "")

                if phase == "think" and status != "finished":
                    reasoning += content
                elif phase == "thinking_summary" and status != "finished":
                    pass
                elif phase == "answer" and status != "finished":
                    full_answer += content

                if status == "finished" and phase == "answer":
                    break

            msg = {"role": "assistant", "content": full_answer}
            if reasoning:
                msg["reasoning_content"] = reasoning

            resp = {
                "id": _make_id(),
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": msg,
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            }
            self._respond(200, "application/json", json.dumps(resp).encode())
        except Exception as e:
            self._error(500, str(e))
        finally:
            if chat_id:
                delete_chat(token, chat_id)

    def _respond(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, msg: str):
        print(f"[qwen-proxy] Error {code}: {msg}")
        body = json.dumps(
            {"error": {"message": msg, "type": "proxy_error"}}
        ).encode()
        self._respond(code, "application/json", body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("QWEN_PROXY_PORT", "4320"))
    host = "127.0.0.1"
    print(f"[qwen-proxy] Starting on http://{host}:{port}")
    print(f"[qwen-proxy] Endpoint: http://{host}:{port}/v1/chat/completions")
    print(f"[qwen-proxy] Models:   http://{host}:{port}/v1/models")
    print(f"[qwen-proxy] Health:   http://{host}:{port}/health")

    try:
        token = load_token()
        print(f"[qwen-proxy] Auth token loaded: {token[:20]}...")
    except RuntimeError as e:
        print(f"[qwen-proxy] WARNING: {e}")

    bh = load_browser_headers()
    if bh.get("bx-umidtoken"):
        print(f"[qwen-proxy] Browser headers loaded (bx-umidtoken, bx-ua, cookies)")
    else:
        print(f"[qwen-proxy] WARNING: No browser headers found at {BROWSER_HEADERS_FILE}")
        print(f"[qwen-proxy]   Run MITM capture to generate them.")

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[qwen-proxy] Shutting down.")
        server.shutdown()

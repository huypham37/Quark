#!/usr/bin/env python3
"""
claude-web-proxy.py — OpenAI-compatible proxy to claude.ai webapp

Listens on 127.0.0.1:4318, accepts POST /v1/chat/completions,
translates to claude.ai webapp API calls using curl_cffi + Safari impersonation.

Supports tool calling by:
  1. Injecting tool schemas into the prompt sent to claude.ai
  2. Parsing text responses for <tool_call> JSON blocks
  3. Emitting synthetic OpenAI delta.tool_calls chunks

Usage:
    python3 scripts/claude-web-proxy.py

Config (env vars):
    CLAUDE_PROXY_PORT         Port to listen on (default: 4318)
    CLAUDE_ORG_UUID           Org UUID (auto-discovered if not set)
    CLAUDE_WEB_PROXY_API_KEY  Session key override (otherwise reads token file)

Dependencies:
    pip install curl_cffi pycryptodome
"""

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from curl_cffi import requests as cffi_requests
from Crypto.Cipher import AES

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CLAUDE_BASE = "https://claude.ai"
ELECTRON_COOKIE_DB = (
    Path.home() / "Library" / "Application Support" / "Claude" / "Cookies"
)
TOKEN_FILE = Path.home() / ".config" / "atom" / "claude-web-proxy-token.json"
KEYCHAIN_SERVICE = "Claude Safe Storage"
ORG_UUID_CACHE = Path.home() / ".config" / "atom" / "claude-org-uuid.txt"

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Safari/605.1.15"
)

# ---------------------------------------------------------------------------
# Cookie decryption (Electron / macOS Keychain)
# ---------------------------------------------------------------------------


def _keychain_key() -> bytes:
    raw = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return hashlib.pbkdf2_hmac("sha1", raw.encode(), b"saltysalt", 1003, dklen=16)


def _decrypt(enc: bytes, key: bytes) -> str:
    if not enc.startswith(b"v10"):
        return enc.decode("utf-8", errors="replace")
    iv = b" " * 16
    raw = AES.new(key, AES.MODE_CBC, iv).decrypt(enc[3:])
    pad = raw[-1] if isinstance(raw[-1], int) else ord(raw[-1])
    raw = raw[:-pad]
    return raw.decode("latin-1", errors="replace")


def load_cookies() -> dict:
    """Load all claude.ai cookies from the Electron app's SQLite store."""
    if not ELECTRON_COOKIE_DB.exists():
        print(
            "[proxy] Warning: Electron cookie DB not found, proceeding without CF cookies"
        )
        return {}
    try:
        key = _keychain_key()
    except Exception as e:
        print(f"[proxy] Warning: could not read Keychain key: {e}")
        return {}

    conn = sqlite3.connect(str(ELECTRON_COOKIE_DB))
    rows = conn.execute(
        "SELECT name, value, encrypted_value FROM cookies "
        "WHERE host_key LIKE '%claude.ai%' OR host_key LIKE '%anthropic.com%'"
    ).fetchall()
    conn.close()

    cookies: dict = {}
    for name, value, enc in rows:
        if enc:
            try:
                dec = _decrypt(bytes(enc), key)
                m = re.search(r"[\x20-\x7e]{4,}", dec)
                if m:
                    cookies[name] = m.group(0)
                    continue
            except Exception:
                pass
        if value:
            cookies[name] = value
    return cookies


# ---------------------------------------------------------------------------
# Session key + org UUID
# ---------------------------------------------------------------------------


def load_session_key() -> str:
    key = os.environ.get("CLAUDE_WEB_PROXY_API_KEY")
    if key:
        return key
    if TOKEN_FILE.exists():
        try:
            data = json.loads(TOKEN_FILE.read_text())
            if data.get("apiKey"):
                return data["apiKey"]
        except Exception:
            pass
    raise RuntimeError(
        "No session key found. Set CLAUDE_WEB_PROXY_API_KEY "
        "or save to ~/.config/atom/claude-web-proxy-token.json"
    )


def discover_org_uuid(session_key: str, cookies: dict) -> str:
    env_org = os.environ.get("CLAUDE_ORG_UUID")
    if env_org:
        return env_org
    if ORG_UUID_CACHE.exists():
        cached = ORG_UUID_CACHE.read_text().strip()
        if cached:
            return cached

    resp = cffi_requests.get(
        f"{CLAUDE_BASE}/api/organizations",
        headers=_headers(session_key, cookies),
        impersonate="safari17_0",
        timeout=30,
    )
    resp.raise_for_status()
    orgs = resp.json()
    if not orgs:
        raise RuntimeError("No organizations found in Claude account")
    org = orgs[0]["uuid"]
    ORG_UUID_CACHE.parent.mkdir(parents=True, exist_ok=True)
    ORG_UUID_CACHE.write_text(org)
    return org


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _headers(session_key: str, cookies: dict) -> dict:
    merged = {**cookies, "sessionKey": session_key}
    cookie_str = "; ".join(f"{k}={v}" for k, v in merged.items())
    return {
        "Cookie": cookie_str,
        "User-Agent": SAFARI_UA,
        "Accept": "text/event-stream, application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "Origin": "https://claude.ai",
        "Referer": "https://claude.ai/",
        "anthropic-client-platform": "web_claude_ai",
    }


# ---------------------------------------------------------------------------
# Claude webapp calls
# ---------------------------------------------------------------------------


def create_conversation(org: str, session_key: str, cookies: dict) -> str:
    conv_id = str(uuid.uuid4())
    resp = cffi_requests.post(
        f"{CLAUDE_BASE}/api/organizations/{org}/chat_conversations",
        headers=_headers(session_key, cookies),
        json={"uuid": conv_id, "name": ""},
        impersonate="safari17_0",
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"Failed to create conversation: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()["uuid"]


def stream_completion(
    org: str, conv: str, session_key: str, cookies: dict, prompt: str, model: str
):
    """Yield decoded SSE data lines from claude.ai."""
    resp = cffi_requests.post(
        f"{CLAUDE_BASE}/api/organizations/{org}/chat_conversations/{conv}/completion",
        headers=_headers(session_key, cookies),
        json={
            "prompt": prompt,
            "model": model,
            "timezone": "UTC",
            "attachments": [],
            "files": [],
        },
        impersonate="safari17_0",
        stream=True,
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Completion failed: {resp.status_code} {resp.text[:400]}")
    for line in resp.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="replace")
        yield line


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
    """Build a text preamble describing available tools in the prompt."""
    if not tools:
        return ""
    lines = [TOOL_SYSTEM_PREAMBLE]
    for t in tools:
        # Handle OpenAI format: {"type":"function","function":{...}}
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
            lines.append(f"{desc}")
        if params:
            lines.append(f"Parameters: {json.dumps(params)}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Message format translation
# ---------------------------------------------------------------------------


def messages_to_prompt(messages: list, tools: list | None = None) -> str:
    """Convert OpenAI messages list to Claude Human/Assistant prompt string."""
    tool_preamble = build_tool_preamble(tools) if tools else ""

    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            content = "".join(
                p.get("text", "") for p in content if p.get("type") == "text"
            )

        if role == "system":
            sys_text = content
            if tool_preamble:
                sys_text = tool_preamble + "\n\n" + content
                tool_preamble = ""  # Only inject once
            parts.append(f"\n\nHuman: <system>\n{sys_text}\n</system>")
        elif role == "user":
            parts.append(f"\n\nHuman: {content}")
        elif role == "assistant":
            # Check for tool_calls in assistant message (conversation history)
            tool_calls = msg.get("tool_calls", [])
            if tool_calls:
                tc_text = content or ""
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    tc_text += f"\n<tool_call>\n"
                    tc_text += json.dumps(
                        {
                            "name": fn.get("name", ""),
                            "arguments": json.loads(fn.get("arguments", "{}")),
                        }
                    )
                    tc_text += f"\n</tool_call>"
                parts.append(f"\n\nAssistant: {tc_text}")
            else:
                parts.append(f"\n\nAssistant: {content}")
        elif role == "tool":
            # Tool result — inject as Human turn with tool_result tags
            tool_call_id = msg.get("tool_call_id", "")
            parts.append(
                f'\n\nHuman: <tool_result tool_call_id="{tool_call_id}">\n{content}\n</tool_result>'
            )

    # If tool preamble wasn't injected (no system message), inject as first Human turn
    if tool_preamble:
        parts.insert(0, f"\n\nHuman: <system>\n{tool_preamble}\n</system>")

    parts.append("\n\nAssistant:")
    return "".join(parts)


# ---------------------------------------------------------------------------
# Tool call parser — extract <tool_call> blocks from streamed text
# ---------------------------------------------------------------------------

TOOL_CALL_OPEN = "<tool_call>"
TOOL_CALL_CLOSE = "</tool_call>"


class ToolCallParser:
    """
    Accumulates streamed text and detects <tool_call>...</tool_call> blocks.

    Emits events:
      ("text", str)        — normal text content
      ("tool_call", dict)  — parsed tool call: {"name":..., "arguments":...}
      ("flush", str)       — remaining text at end
    """

    def __init__(self):
        self._buf = ""
        self._in_tag = False
        self._tag_buf = ""

    def feed(self, text: str):
        """Feed text chunk, yield events."""
        self._buf += text

        while True:
            if not self._in_tag:
                idx = self._buf.find(TOOL_CALL_OPEN)
                if idx == -1:
                    # No opening tag found yet.
                    # Emit text up to last few chars (keep tail in case partial tag)
                    safe = len(self._buf) - len(TOOL_CALL_OPEN)
                    if safe > 0:
                        yield ("text", self._buf[:safe])
                        self._buf = self._buf[safe:]
                    break
                else:
                    # Found opening tag — emit text before it
                    if idx > 0:
                        yield ("text", self._buf[:idx])
                    self._buf = self._buf[idx + len(TOOL_CALL_OPEN) :]
                    self._in_tag = True
                    self._tag_buf = ""
            else:
                # Inside <tool_call>, look for closing tag
                idx = self._buf.find(TOOL_CALL_CLOSE)
                if idx == -1:
                    self._tag_buf += self._buf
                    self._buf = ""
                    break
                else:
                    self._tag_buf += self._buf[:idx]
                    self._buf = self._buf[idx + len(TOOL_CALL_CLOSE) :]
                    self._in_tag = False
                    # Parse the JSON
                    try:
                        obj = json.loads(self._tag_buf.strip())
                        yield ("tool_call", obj)
                    except json.JSONDecodeError:
                        # Failed to parse — emit as text with tags
                        yield ("text", TOOL_CALL_OPEN + self._tag_buf + TOOL_CALL_CLOSE)
                    self._tag_buf = ""

    def flush(self):
        """Call at end of stream to emit any remaining buffered text."""
        remaining = self._buf
        if self._in_tag:
            remaining = TOOL_CALL_OPEN + self._tag_buf + remaining
        if remaining:
            yield ("text", remaining)
        self._buf = ""
        self._tag_buf = ""
        self._in_tag = False


# ---------------------------------------------------------------------------
# OpenAI SSE chunk builders
# ---------------------------------------------------------------------------


def _make_chunk_id():
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"


def _sse_text_chunk(
    content: str, model: str, chunk_id: str, finish_reason=None
) -> bytes:
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


def _sse_tool_call_start(
    model: str, chunk_id: str, call_index: int, call_id: str, name: str
) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {
                    "tool_calls": [
                        {
                            "index": call_index,
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": ""},
                        }
                    ]
                },
                "finish_reason": None,
            }
        ],
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
        "choices": [
            {
                "index": 0,
                "delta": {
                    "tool_calls": [
                        {
                            "index": call_index,
                            "function": {"arguments": args_json},
                        }
                    ]
                },
                "finish_reason": None,
            }
        ],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def _sse_finish(model: str, chunk_id: str, reason: str) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {},
                "finish_reason": reason,
            }
        ],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


_SSE_DONE = b"data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Global initialisation (lazy, thread-safe)
# ---------------------------------------------------------------------------

_state: dict = {"cookies": {}, "session_key": "", "org_uuid": "", "ready": False}
_init_lock = threading.Lock()


def _init():
    global _state
    with _init_lock:
        if _state["ready"]:
            return
        print("[proxy] Loading cookies from Electron store...")
        cookies = load_cookies()
        print(f"[proxy] Loaded {len(cookies)} cookies: {list(cookies.keys())}")
        session_key = load_session_key()
        print(f"[proxy] Session key: {session_key[:20]}...")
        org = discover_org_uuid(session_key, cookies)
        print(f"[proxy] Org UUID: {org}")
        _state.update(
            cookies=cookies, session_key=session_key, org_uuid=org, ready=True
        )


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[proxy] {self.address_string()} {fmt % args}")

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "org": _state.get("org_uuid", "")}).encode()
            self._respond(200, "application/json", body)
        else:
            self._respond(404, "application/json", b'{"error":"not found"}')

    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self._respond(404, "application/json", b'{"error":"not found"}')
            return

        try:
            _init()
        except Exception as e:
            return self._error(500, str(e))

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception as e:
            return self._error(400, f"Invalid JSON: {e}")

        messages = body.get("messages", [])
        model = body.get("model", "claude-haiku-4-5-20251001")
        stream = body.get("stream", False)
        tools = body.get("tools", [])

        # Strip provider prefix e.g. "claude-web-proxy/claude-haiku-..."
        if "/" in model:
            model = model.split("/", 1)[1]

        has_tools = bool(tools)

        try:
            prompt = messages_to_prompt(messages, tools if has_tools else None)
            conv = create_conversation(
                _state["org_uuid"], _state["session_key"], _state["cookies"]
            )
        except Exception as e:
            return self._error(500, str(e))

        if stream:
            self._stream(conv, prompt, model, has_tools)
        else:
            self._collect(conv, prompt, model, has_tools)

    # ------------------------------------------------------------------
    def _stream(self, conv: str, prompt: str, model: str, has_tools: bool):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        chunk_id = _make_chunk_id()
        parser = ToolCallParser() if has_tools else None
        tool_call_index = 0
        saw_tool_call = False
        saw_text = False

        try:
            for line in stream_completion(
                _state["org_uuid"],
                conv,
                _state["session_key"],
                _state["cookies"],
                prompt,
                model,
            ):
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if not data_str:
                    continue
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                if data.get("type") != "completion":
                    continue

                text = data.get("completion", "")
                stop = data.get("stop_reason")

                if text and parser:
                    for event_type, event_data in parser.feed(text):
                        if event_type == "text":
                            saw_text = True
                            self.wfile.write(
                                _sse_text_chunk(event_data, model, chunk_id)
                            )
                            self.wfile.flush()
                        elif event_type == "tool_call":
                            saw_tool_call = True
                            call_id = f"call_{uuid.uuid4().hex[:12]}"
                            name = event_data.get("name", "")
                            args = event_data.get("arguments", {})
                            args_json = (
                                json.dumps(args)
                                if isinstance(args, dict)
                                else str(args)
                            )
                            self.wfile.write(
                                _sse_tool_call_start(
                                    model, chunk_id, tool_call_index, call_id, name
                                )
                            )
                            self.wfile.write(
                                _sse_tool_call_args(
                                    model, chunk_id, tool_call_index, args_json
                                )
                            )
                            self.wfile.flush()
                            tool_call_index += 1
                elif text and not parser:
                    self.wfile.write(_sse_text_chunk(text, model, chunk_id))
                    self.wfile.flush()

                if stop is not None:
                    # Flush remaining buffered text from parser
                    if parser:
                        for event_type, event_data in parser.flush():
                            if event_type == "text" and event_data.strip():
                                self.wfile.write(
                                    _sse_text_chunk(event_data, model, chunk_id)
                                )

                    finish = "tool_calls" if saw_tool_call else "stop"
                    self.wfile.write(_sse_finish(model, chunk_id, finish))
                    self.wfile.write(_SSE_DONE)
                    self.wfile.flush()
                    return

            # Stream ended without explicit stop_reason — flush
            if parser:
                for event_type, event_data in parser.flush():
                    if event_type == "text" and event_data.strip():
                        self.wfile.write(_sse_text_chunk(event_data, model, chunk_id))

            finish = "tool_calls" if saw_tool_call else "stop"
            self.wfile.write(_sse_finish(model, chunk_id, finish))
            self.wfile.write(_SSE_DONE)
        except Exception as e:
            print(f"[proxy] Stream error: {e}")
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
    def _collect(self, conv: str, prompt: str, model: str, has_tools: bool):
        try:
            full = ""
            for line in stream_completion(
                _state["org_uuid"],
                conv,
                _state["session_key"],
                _state["cookies"],
                prompt,
                model,
            ):
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                try:
                    data = json.loads(data_str)
                    if data.get("type") == "completion":
                        full += data.get("completion", "")
                except json.JSONDecodeError:
                    pass

            # Parse tool calls from collected text
            tool_calls_out = []
            text_out = ""
            if has_tools:
                parser = ToolCallParser()
                for event_type, event_data in parser.feed(full):
                    if event_type == "text":
                        text_out += event_data
                    elif event_type == "tool_call":
                        call_id = f"call_{uuid.uuid4().hex[:12]}"
                        args = event_data.get("arguments", {})
                        tool_calls_out.append(
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": event_data.get("name", ""),
                                    "arguments": json.dumps(args)
                                    if isinstance(args, dict)
                                    else str(args),
                                },
                            }
                        )
                for event_type, event_data in parser.flush():
                    if event_type == "text":
                        text_out += event_data
            else:
                text_out = full

            message = {"role": "assistant", "content": text_out.strip() or None}
            if tool_calls_out:
                message["tool_calls"] = tool_calls_out

            resp = {
                "id": _make_chunk_id(),
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "tool_calls" if tool_calls_out else "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            }
            body = json.dumps(resp).encode()
            self._respond(200, "application/json", body)
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
        print(f"[proxy] Error {code}: {msg}")
        body = json.dumps({"error": {"message": msg, "type": "proxy_error"}}).encode()
        self._respond(code, "application/json", body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("CLAUDE_PROXY_PORT", "4318"))
    host = "127.0.0.1"
    print(f"[proxy] claude-web-proxy starting on http://{host}:{port}")
    print(f"[proxy] Endpoint: http://{host}:{port}/v1/chat/completions")
    print(f"[proxy] Tool calling: enabled (pseudo-tool via <tool_call> parsing)")
    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[proxy] Shutting down.")
        server.shutdown()

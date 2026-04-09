"""
providers/claude.py — Claude.ai webapp provider

Auth: Session key + Electron cookie DB (macOS Keychain decryption)
Tools: prompt injection + XML <tool_call> parsing
Thinking: not natively emitted by claude.ai webapp (use API for that)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Iterator

from curl_cffi import requests as cffi_requests
from Crypto.Cipher import AES

from web_proxy.base import WebProvider, SSEEvent, TextDelta, ToolCall, Done
from web_proxy.tools import ToolCallParser, messages_to_prompt as _generic_messages_to_prompt

CLAUDE_BASE = "https://claude.ai"
ELECTRON_COOKIE_DB = Path.home() / "Library" / "Application Support" / "Claude" / "Cookies"
TOKEN_FILE = Path.home() / ".config" / "atom" / "claude-web-proxy-token.json"
ORG_UUID_CACHE = Path.home() / ".config" / "atom" / "claude-org-uuid.txt"
KEYCHAIN_SERVICE = "Claude Safe Storage"

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Safari/605.1.15"
)

CLAUDE_MODELS = [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-5-20251020",
    "claude-haiku-4-5-20251001",
]


def _messages_to_claude_prompt(messages: list, tools: list | None = None) -> str:
    """Claude-specific prompt format using Human:/Assistant: turns."""
    from web_proxy.tools import build_tool_preamble
    tool_preamble = build_tool_preamble(tools) if tools else ""
    parts = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            content = "".join(p.get("text", "") for p in content if p.get("type") == "text")

        if role == "system":
            sys_text = content
            if tool_preamble:
                sys_text = tool_preamble + "\n\n" + content
                tool_preamble = ""
            parts.append(f"\n\nHuman: <system>\n{sys_text}\n</system>")
        elif role == "user":
            parts.append(f"\n\nHuman: {content}")
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
                parts.append(f"\n\nAssistant: {tc_text}")
            else:
                parts.append(f"\n\nAssistant: {content}")
        elif role == "tool":
            tool_call_id = msg.get("tool_call_id", "")
            parts.append(f'\n\nHuman: <tool_result tool_call_id="{tool_call_id}">\n{content}\n</tool_result>')

    if tool_preamble:
        parts.insert(0, f"\n\nHuman: <system>\n{tool_preamble}\n</system>")

    parts.append("\n\nAssistant:")
    return "".join(parts)


class ClaudeProvider(WebProvider):
    name = "claude"

    def __init__(self):
        self._session_key: str = ""
        self._cookies: dict = {}
        self._org_uuid: str = ""
        self._lock = threading.Lock()

    def handles(self, model: str) -> bool:
        m = model.split("/", 1)[-1] if "/" in model else model
        return m.startswith("claude-")

    def authenticate(self) -> bool:
        try:
            self._session_key = self._load_session_key()
            self._cookies = self._load_cookies()
            self._org_uuid = self._discover_org()
            return True
        except Exception as e:
            print(f"[web-proxy] claude: auth failed — {e}")
            return False

    def list_models(self) -> list[dict]:
        return [
            {"id": f"web/{m}", "object": "model", "created": 0, "owned_by": "anthropic"}
            for m in CLAUDE_MODELS
        ]

    def stream(self, messages: list, model: str, tools: list) -> Iterator[SSEEvent]:
        model_id = model.split("/", 1)[-1] if "/" in model else model
        has_tools = bool(tools)
        prompt = _messages_to_claude_prompt(messages, tools if has_tools else None)
        conv = self._create_conversation()
        yield from self._stream_completion(conv, prompt, model_id, has_tools)

    # ------------------------------------------------------------------
    def _load_session_key(self) -> str:
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

    def _load_cookies(self) -> dict:
        if not ELECTRON_COOKIE_DB.exists():
            return {}
        try:
            key = self._keychain_key()
        except Exception:
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
                    dec = self._decrypt(bytes(enc), key)
                    m = re.search(r"[\x20-\x7e]{4,}", dec)
                    if m:
                        cookies[name] = m.group(0)
                        continue
                except Exception:
                    pass
            if value:
                cookies[name] = value
        return cookies

    def _keychain_key(self) -> bytes:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return hashlib.pbkdf2_hmac("sha1", raw.encode(), b"saltysalt", 1003, dklen=16)

    def _decrypt(self, enc: bytes, key: bytes) -> str:
        if not enc.startswith(b"v10"):
            return enc.decode("utf-8", errors="replace")
        iv = b" " * 16
        raw = AES.new(key, AES.MODE_CBC, iv).decrypt(enc[3:])
        pad = raw[-1] if isinstance(raw[-1], int) else ord(raw[-1])
        return raw[:-pad].decode("latin-1", errors="replace")

    def _discover_org(self) -> str:
        env_org = os.environ.get("CLAUDE_ORG_UUID")
        if env_org:
            return env_org
        if ORG_UUID_CACHE.exists():
            cached = ORG_UUID_CACHE.read_text().strip()
            if cached:
                return cached
        resp = cffi_requests.get(
            f"{CLAUDE_BASE}/api/organizations",
            headers=self._headers(),
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

    def _headers(self) -> dict:
        merged = {**self._cookies, "sessionKey": self._session_key}
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

    def _create_conversation(self) -> str:
        conv_id = str(uuid.uuid4())
        resp = cffi_requests.post(
            f"{CLAUDE_BASE}/api/organizations/{self._org_uuid}/chat_conversations",
            headers=self._headers(),
            json={"uuid": conv_id, "name": ""},
            impersonate="safari17_0",
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Failed to create conversation: {resp.status_code} {resp.text[:300]}")
        return resp.json()["uuid"]

    def _raw_stream(self, conv: str, prompt: str, model: str):
        resp = cffi_requests.post(
            f"{CLAUDE_BASE}/api/organizations/{self._org_uuid}/chat_conversations/{conv}/completion",
            headers=self._headers(),
            json={"prompt": prompt, "model": model, "timezone": "UTC", "attachments": [], "files": []},
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

    def _stream_completion(
        self, conv: str, prompt: str, model: str, has_tools: bool
    ) -> Iterator[SSEEvent]:
        parser = ToolCallParser() if has_tools else None
        saw_tool_call = False

        for line in self._raw_stream(conv, prompt, model):
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
                for kind, value in parser.feed(text):
                    if kind == "text" and value:
                        yield TextDelta(text=value)
                    elif kind == "tool_call":
                        saw_tool_call = True
                        yield ToolCall(name=value.get("name", ""), arguments=value.get("arguments", {}))
            elif text:
                yield TextDelta(text=text)

            if stop is not None:
                if parser:
                    for kind, value in parser.flush():
                        if kind == "text" and value.strip():
                            yield TextDelta(text=value)
                        elif kind == "tool_call":
                            saw_tool_call = True
                            yield ToolCall(name=value.get("name", ""), arguments=value.get("arguments", {}))
                yield Done(finish_reason="tool_calls" if saw_tool_call else "stop")
                return

        # Ended without stop_reason
        if parser:
            for kind, value in parser.flush():
                if kind == "text" and value.strip():
                    yield TextDelta(text=value)
                elif kind == "tool_call":
                    saw_tool_call = True
                    yield ToolCall(name=value.get("name", ""), arguments=value.get("arguments", {}))
        yield Done(finish_reason="tool_calls" if saw_tool_call else "stop")

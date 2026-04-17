"""
providers/qwen.py — Qwen webapp provider (chat.qwen.ai)

Auth: JWT token cookie from chat.qwen.ai
Thinking: phase-based (phase="think") + thinking_summary (qwen3.6-plus)
Tools: prompt injection + XML <tool_call> parsing (native tool execution suppressed)
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Iterator

import requests

from web_proxy.auth import load_token_file, CONFIG_DIR
from web_proxy.base import WebProvider, SSEEvent, TextDelta, ReasoningDelta, ToolCall, Done
from web_proxy.tools import messages_to_prompt

QWEN_BASE = "https://chat.qwen.ai"
BROWSER_HEADERS_FILE = CONFIG_DIR / "qwen-web-proxy-browser-headers.json"

SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)

MODEL_MAP = {
    "qwen": "qwen3-max",
    "qwen3": "qwen3-max",
    "qwen3-coder": "qwen3-coder-plus",
    "qwen-max": "qwen-max-latest",
    "qwq": "qwq-32b",
}


class QwenProvider(WebProvider):
    name = "qwen"

    def __init__(self):
        self._token: str = ""
        self._known_models: set[str] = set()

    def handles(self, model: str) -> bool:
        m = model.split("/", 1)[-1] if "/" in model else model
        return (
            m.startswith("qwen") or
            m.startswith("qwq") or
            m in MODEL_MAP or
            m in self._known_models
        )

    def authenticate(self) -> bool:
        try:
            self._token = load_token_file(
                "qwen-web-proxy-token.json", "token", "QWEN_AUTH_TOKEN"
            )
            # Warm up: fetch model list to validate token
            models = self._fetch_models()
            self._known_models = {m["id"] for m in models}
            return True
        except Exception:
            return False

    def list_models(self) -> list[dict]:
        return [
            {"id": f"web/{m}", "object": "model", "created": 0, "owned_by": "qwen"}
            for m in sorted(self._known_models)
        ] or [
            {"id": "web/qwen3.6-plus", "object": "model", "created": 0, "owned_by": "qwen"},
            {"id": "web/qwen3-coder-plus", "object": "model", "created": 0, "owned_by": "qwen"},
        ]

    def _build_prompt(self, messages: list, tools: list | None) -> str:
        return messages_to_prompt(messages, tools)

    def _raw_stream(self, prompt: str, model: str, **kw) -> Iterator[SSEEvent]:
        # Not used directly — stream() manages the chat_id lifecycle
        raise NotImplementedError

    def stream(self, messages: list, model: str, tools: list) -> Iterator[SSEEvent]:
        """Override to manage Qwen chat_id lifecycle around _stream_chat."""
        from web_proxy.tools import ToolCallParser
        model_id = self._resolve_model(model)
        user_input = self._build_prompt(messages, tools if tools else None)
        has_tools = bool(tools)
        parser = ToolCallParser() if has_tools else None
        saw_tool_call = False
        chat_id = self._create_chat(model_id)
        try:
            for event in self._stream_chat(user_input, model_id, has_tools, chat_id):
                if isinstance(event, TextDelta):
                    if parser:
                        for kind, value in parser.feed(event.text):
                            if kind == "text" and value:
                                yield TextDelta(text=value)
                            elif kind == "tool_call":
                                saw_tool_call = True
                                yield ToolCall(name=value.get("name", ""), arguments=value.get("arguments", {}))
                    else:
                        yield event
                elif isinstance(event, ReasoningDelta):
                    yield event
                elif isinstance(event, ToolCall):
                    saw_tool_call = True
                    yield event
        finally:
            self._delete_chat(chat_id)

        if parser:
            for kind, value in parser.flush():
                if kind == "text" and value.strip():
                    yield TextDelta(text=value)
                elif kind == "tool_call":
                    saw_tool_call = True
                    yield ToolCall(name=value.get("name", ""), arguments=value.get("arguments", {}))

        yield Done(finish_reason="tool_calls" if saw_tool_call else "stop")

    def _resolve_model(self, model: str) -> str:
        m = model.split("/", 1)[-1] if "/" in model else model
        if m in MODEL_MAP:
            return MODEL_MAP[m]
        return m

    def _headers(self) -> dict:
        bh: dict = {}
        if BROWSER_HEADERS_FILE.exists():
            try:
                bh = json.loads(BROWSER_HEADERS_FILE.read_text())
            except Exception:
                pass
        hdrs = {
            "User-Agent": SAFARI_UA,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._token}",
            "Origin": QWEN_BASE,
            "Referer": f"{QWEN_BASE}/c/guest",
            "source": "web",
            "Connection": "keep-alive",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "X-Request-Id": str(uuid.uuid4()),
        }
        for key in ("bx-umidtoken", "bx-ua", "bx-v", "Version", "Timezone", "Cookie"):
            if key in bh:
                hdrs[key] = bh[key]
        return hdrs

    def _fetch_models(self) -> list[dict]:
        resp = requests.get(f"{QWEN_BASE}/api/models", headers=self._headers(), timeout=30)
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    def _create_chat(self, model_id: str) -> str:
        payload = {
            "title": "New Chat",
            "models": [model_id],
            "chat_mode": "normal",
            "chat_type": "t2t",
            "timestamp": int(time.time() * 1000),
        }
        resp = requests.post(
            f"{QWEN_BASE}/api/v2/chats/new",
            headers=self._headers(),
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["data"]["id"]

    def _delete_chat(self, chat_id: str):
        try:
            requests.delete(
                f"{QWEN_BASE}/api/v2/chats/{chat_id}",
                headers=self._headers(),
                timeout=10,
            )
        except Exception:
            pass

    def _raw_stream_http(self, chat_id: str, model_id: str, user_input: str, has_tools: bool = False):
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
        # Disable native function calling when we're using prompt-injected tools.
        # Without this, Qwen 3.6-plus emits native function_call deltas with
        # empty name/args, its server-side tries to execute them, fails, and
        # the stream ends with no content.
        if has_tools:
            feature_config["function_call_enabled"] = False
            feature_config["tool_choice"] = "none"
        payload = {
            "stream": True,
            "version": "2.1",
            "incremental_output": True,
            "chat_id": chat_id,
            "chat_mode": "normal",
            "model": model_id,
            "parent_id": None,
            "messages": [{
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
            }],
            "timestamp": ts,
        }
        hdrs = self._headers()
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
            raise RuntimeError(f"Qwen returned {resp.status_code}: {resp.text[:400]}")
        for raw_line in resp.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data_str = raw_line[5:].strip()
            if data_str == "[DONE]":
                return
            try:
                obj = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            # Surface fatal API errors (not InternalError — those are from
            # Qwen's server-side tool execution attempt, which we can ignore
            # because we handle tool calls ourselves via XML parsing).
            # IMPORTANT: continue, not return — answer tokens may follow.
            if "error" in obj and "choices" not in obj:
                err = obj["error"]
                code = err.get("code", "unknown")
                details = err.get("details", str(err))
                # InternalError from Qwen's tool execution attempt — skip this event
                if "InternalError" in str(details) or "function.arguments" in str(details):
                    print(f"[web-proxy] qwen: ignoring server-side tool execution error: {details[:100]}")
                    continue
                raise RuntimeError(f"Qwen API error: {code}: {details}")
            yield obj

    def _stream_chat(
        self, user_input: str, model_id: str, has_tools: bool, chat_id: str
    ) -> Iterator[SSEEvent]:
        # Native function_call accumulator (qwen3.6-plus emits these incrementally)
        active_fc_name: str | None = None
        active_fc_args: str = ""
        # Thinking summary accumulator for qwen3.6-plus (cumulative arrays)
        _summary_seen: int = 0

        def _flush_native_fc():
            nonlocal active_fc_name, active_fc_args
            if active_fc_name:
                try:
                    args = json.loads(active_fc_args) if active_fc_args else {}
                except json.JSONDecodeError:
                    args = {}
                yield ToolCall(name=active_fc_name, arguments=args)
                active_fc_name = None
                active_fc_args = ""

        for event in self._raw_stream_http(chat_id, model_id, user_input, has_tools=has_tools):
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

            # Suppress Qwen's failed server-side tool execution errors (role=function)
            if delta.get("role") == "function":
                continue

            # Native function_call (qwen3.6-plus style) — accumulate and yield as ToolCall
            if fc and has_tools:
                fc_name = fc.get("name", "")
                fc_args = fc.get("arguments", "")
                # Skip empty native FC (Qwen emits these when server-side tool
                # execution is triggered but the function isn't registered).
                if not fc_name and active_fc_name is None:
                    continue
                if fc_name and fc_name != active_fc_name:
                    yield from _flush_native_fc()
                    active_fc_name = fc_name
                    active_fc_args = fc_args
                elif active_fc_name is not None:
                    active_fc_args = fc_args
                continue

            # Reasoning
            if reasoning:
                yield ReasoningDelta(text=reasoning)

            # Phase-based thinking (qwen3-max, qwen3-coder-plus)
            if phase == "think" and status != "finished" and content:
                yield ReasoningDelta(text=content)
                continue

            # Thinking summary (qwen3.6-plus): cumulative arrays in delta.extra
            elif phase == "thinking_summary" and status != "finished":
                extra = delta.get("extra", {})
                thoughts = extra.get("summary_thought", {}).get("content", [])
                if len(thoughts) > _summary_seen:
                    for t in thoughts[_summary_seen:]:
                        if t:
                            yield ReasoningDelta(text=t + "\n")
                    _summary_seen = len(thoughts)
                continue

            # Text content
            if phase == "answer" or (phase is None and content):
                yield from _flush_native_fc()
                if content:
                    yield TextDelta(text=content)

            # Stream finished
            is_done = (status == "finished" and phase == "answer") or finish == "stop"
            if is_done:
                yield from _flush_native_fc()
                return

        # Stream ended early — flush native FC if pending
        yield from _flush_native_fc()

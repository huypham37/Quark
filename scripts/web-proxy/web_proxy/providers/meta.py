"""
providers/meta.py — Meta.ai webapp provider

Auth: rd_challenge + ecto_1_sess cookies (env vars)
Tools: not supported
Thinking: emitted as ReasoningDelta (thinking sections)
"""

from __future__ import annotations

import json
import os
import random
import time
import uuid
from typing import Iterator

import requests as http_requests

from web_proxy.base import WebProvider, SSEEvent, TextDelta, ReasoningDelta, Done

META_GRAPHQL = "https://meta.ai/api/graphql"
WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb"
SEND_DOC_ID = "62fbc9b911a73008132a4f5333387703"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.3.1 Safari/605.1.15"
)


def _unique_message_id() -> str:
    now = int(time.time() * 1000)
    rb = random.getrandbits(22)
    return str(((2199023255551 & now) << 22) | rb)


class MetaProvider(WebProvider):
    name = "meta"

    def __init__(self):
        self._cookies: dict = {}

    def handles(self, model: str) -> bool:
        m = model.split("/", 1)[-1] if "/" in model else model
        return m.startswith("meta") or m.startswith("llama")

    def authenticate(self) -> bool:
        rd = os.environ.get("META_RD_CHALLENGE", "")
        ecto = os.environ.get("META_ECTO_SESS", "")
        if not rd or not ecto:
            return False
        self._cookies = {"rd_challenge": rd, "ecto_1_sess": ecto}
        return True

    def list_models(self) -> list[dict]:
        return [
            {"id": "web/meta-ai", "object": "model", "created": 0, "owned_by": "meta"},
            {"id": "web/llama", "object": "model", "created": 0, "owned_by": "meta"},
        ]

    def stream(self, messages: list, model: str, tools: list) -> Iterator[SSEEvent]:
        # Extract last user message
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

        conv_id = str(uuid.uuid4())
        self._warmup(conv_id)
        yield from self._send_message(conv_id, query)

    # ------------------------------------------------------------------
    def _base_headers(self) -> dict:
        return {
            "User-Agent": UA,
            "Origin": "https://meta.ai",
            "Content-Type": "application/json",
        }

    def _warmup(self, conv_id: str):
        try:
            http_requests.post(
                META_GRAPHQL,
                cookies=self._cookies,
                headers=self._base_headers(),
                json={"doc_id": WARMUP_DOC_ID, "variables": {"conversationId": conv_id}},
                timeout=10,
            )
        except Exception:
            pass

    def _send_message(self, conv_id: str, message: str) -> Iterator[SSEEvent]:
        r = http_requests.post(
            META_GRAPHQL,
            cookies=self._cookies,
            headers=self._base_headers(),
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
            self._cookies[c.name] = c.value

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
                            yield ReasoningDelta(text=thought)

                elif "MarkdownText" in tn:
                    text = prim.get("text", "")
                    if text and text != prev_text:
                        if text.startswith(prev_text):
                            delta = text[len(prev_text):]
                            if delta:
                                yield TextDelta(text=delta)
                        else:
                            yield TextDelta(text=text)
                        prev_text = text

            if msg.get("streamingState") == "DONE" and prev_text:
                yield Done()
                return

        yield Done()

"""
sse.py — Shared OpenAI-compatible SSE chunk builders.

All providers yield abstract events (TextDelta, ReasoningDelta, ToolCall, Done).
The server calls these builders to convert them to wire-format SSE bytes.
"""

import json
import time
import uuid


def make_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"


_SSE_DONE = b"data: [DONE]\n\n"


def sse_done() -> bytes:
    return _SSE_DONE


def sse_text(content: str, model: str, chunk_id: str, finish_reason=None) -> bytes:
    delta: dict = {}
    if content:
        delta["content"] = content
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def sse_reasoning(reasoning: str, model: str, chunk_id: str) -> bytes:
    """Emit delta.reasoning_content — consumed by @ai-sdk/alibaba on the Quark side."""
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {"reasoning_content": reasoning}, "finish_reason": None}],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def sse_tool_call_start(
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


def sse_tool_call_args(
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
                "tool_calls": [{"index": call_index, "function": {"arguments": args_json}}]
            },
            "finish_reason": None,
        }],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def sse_finish(model: str, chunk_id: str, reason: str) -> bytes:
    obj = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": reason}],
    }
    return f"data: {json.dumps(obj)}\n\n".encode()


def non_stream_response(
    model: str,
    chunk_id: str,
    text: str,
    tool_calls: list | None = None,
    reasoning: str | None = None,
) -> dict:
    """Build a non-streaming /v1/chat/completions response body."""
    message: dict = {"role": "assistant", "content": text.strip() or None}
    if reasoning:
        message["reasoning_content"] = reasoning
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": chunk_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": "tool_calls" if tool_calls else "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }

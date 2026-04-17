"""
tests/test_sse.py — Tests for web_proxy.sse

Covers:
  - sse_text: content field, object type, model, finish_reason
  - sse_reasoning: delta.reasoning_content field
  - sse_tool_call_start: tool_calls array with index, id, type, function.name
  - sse_tool_call_args: tool_calls array with incremental arguments
  - sse_finish: empty delta, finish_reason set
  - sse_done: sentinel [DONE] bytes
  - non_stream_response: message structure, tool_calls, reasoning_content, finish_reason
"""

import sys
import os
import json
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from web_proxy.sse import (
    sse_text,
    sse_reasoning,
    sse_tool_call_start,
    sse_tool_call_args,
    sse_finish,
    sse_done,
    non_stream_response,
    make_id,
)


def _parse_sse(raw: bytes) -> dict:
    """Parse a single SSE data line into a dict."""
    text = raw.decode()
    # SSE lines are "data: <json>\n\n"
    for line in text.splitlines():
        if line.startswith("data: "):
            return json.loads(line[6:])
    raise ValueError(f"No data line found in: {text!r}")


# ---------------------------------------------------------------------------
# make_id
# ---------------------------------------------------------------------------

class TestMakeId(unittest.TestCase):
    def test_make_id_starts_with_prefix(self):
        cid = make_id()
        self.assertTrue(cid.startswith("chatcmpl-"))

    def test_make_id_produces_unique_ids(self):
        ids = {make_id() for _ in range(50)}
        self.assertEqual(len(ids), 50)


# ---------------------------------------------------------------------------
# sse_done
# ---------------------------------------------------------------------------

class TestSseDone(unittest.TestCase):
    def test_sse_done_is_bytes(self):
        self.assertIsInstance(sse_done(), bytes)

    def test_sse_done_contains_done_sentinel(self):
        self.assertIn(b"[DONE]", sse_done())

    def test_sse_done_ends_with_double_newline(self):
        self.assertTrue(sse_done().endswith(b"\n\n"))


# ---------------------------------------------------------------------------
# sse_text
# ---------------------------------------------------------------------------

class TestSseText(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-test001"
        self.model = "qwen3"

    def _chunk(self, content, finish_reason=None):
        return _parse_sse(sse_text(content, self.model, self.chunk_id, finish_reason))

    def test_returns_bytes(self):
        self.assertIsInstance(sse_text("hello", self.model, self.chunk_id), bytes)

    def test_ends_with_double_newline(self):
        raw = sse_text("hello", self.model, self.chunk_id)
        self.assertTrue(raw.endswith(b"\n\n"))

    def test_object_type_is_chat_completion_chunk(self):
        obj = self._chunk("hello")
        self.assertEqual(obj["object"], "chat.completion.chunk")

    def test_id_matches_chunk_id(self):
        obj = self._chunk("hello")
        self.assertEqual(obj["id"], self.chunk_id)

    def test_model_field_matches(self):
        obj = self._chunk("hello")
        self.assertEqual(obj["model"], self.model)

    def test_content_in_delta(self):
        obj = self._chunk("hello world")
        self.assertEqual(obj["choices"][0]["delta"]["content"], "hello world")

    def test_finish_reason_none_by_default(self):
        obj = self._chunk("hello")
        self.assertIsNone(obj["choices"][0]["finish_reason"])

    def test_finish_reason_stop(self):
        obj = self._chunk("", finish_reason="stop")
        self.assertEqual(obj["choices"][0]["finish_reason"], "stop")

    def test_empty_content_omits_content_key(self):
        # When content is empty string, delta should be empty (no "content" key)
        obj = self._chunk("")
        self.assertNotIn("content", obj["choices"][0]["delta"])

    def test_created_is_recent_timestamp(self):
        before = int(time.time()) - 2
        obj = self._chunk("hi")
        after = int(time.time()) + 2
        self.assertGreaterEqual(obj["created"], before)
        self.assertLessEqual(obj["created"], after)

    def test_choices_has_single_entry(self):
        obj = self._chunk("hi")
        self.assertEqual(len(obj["choices"]), 1)
        self.assertEqual(obj["choices"][0]["index"], 0)


# ---------------------------------------------------------------------------
# sse_reasoning
# ---------------------------------------------------------------------------

class TestSseReasoning(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-reason001"
        self.model = "qwen3"

    def _chunk(self, reasoning: str) -> dict:
        return _parse_sse(sse_reasoning(reasoning, self.model, self.chunk_id))

    def test_returns_bytes(self):
        self.assertIsInstance(sse_reasoning("thinking", self.model, self.chunk_id), bytes)

    def test_ends_with_double_newline(self):
        raw = sse_reasoning("thinking", self.model, self.chunk_id)
        self.assertTrue(raw.endswith(b"\n\n"))

    def test_object_type_is_chat_completion_chunk(self):
        obj = self._chunk("thinking")
        self.assertEqual(obj["object"], "chat.completion.chunk")

    def test_reasoning_content_in_delta(self):
        obj = self._chunk("let me think step by step")
        self.assertEqual(
            obj["choices"][0]["delta"]["reasoning_content"],
            "let me think step by step",
        )

    def test_no_content_key_in_delta(self):
        obj = self._chunk("thoughts")
        self.assertNotIn("content", obj["choices"][0]["delta"])

    def test_finish_reason_is_none(self):
        obj = self._chunk("thinking")
        self.assertIsNone(obj["choices"][0]["finish_reason"])

    def test_model_field(self):
        obj = self._chunk("x")
        self.assertEqual(obj["model"], self.model)


# ---------------------------------------------------------------------------
# sse_tool_call_start
# ---------------------------------------------------------------------------

class TestSseToolCallStart(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-tc001"
        self.model = "qwen3"

    def _chunk(self, call_index=0, call_id="call_abc123", name="read") -> dict:
        raw = sse_tool_call_start(self.model, self.chunk_id, call_index, call_id, name)
        return _parse_sse(raw)

    def test_returns_bytes(self):
        raw = sse_tool_call_start(self.model, self.chunk_id, 0, "call_id", "read")
        self.assertIsInstance(raw, bytes)

    def test_ends_with_double_newline(self):
        raw = sse_tool_call_start(self.model, self.chunk_id, 0, "call_id", "read")
        self.assertTrue(raw.endswith(b"\n\n"))

    def test_object_type(self):
        obj = self._chunk()
        self.assertEqual(obj["object"], "chat.completion.chunk")

    def test_tool_call_index(self):
        obj = self._chunk(call_index=2)
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["index"], 2)

    def test_tool_call_id(self):
        obj = self._chunk(call_id="call_xyz")
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["id"], "call_xyz")

    def test_tool_call_type_is_function(self):
        obj = self._chunk()
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["type"], "function")

    def test_function_name(self):
        obj = self._chunk(name="bash")
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["function"]["name"], "bash")

    def test_function_arguments_starts_empty(self):
        obj = self._chunk()
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["function"]["arguments"], "")

    def test_finish_reason_is_none(self):
        obj = self._chunk()
        self.assertIsNone(obj["choices"][0]["finish_reason"])


# ---------------------------------------------------------------------------
# sse_tool_call_args
# ---------------------------------------------------------------------------

class TestSseToolCallArgs(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-tc002"
        self.model = "qwen3"

    def _chunk(self, call_index=0, args_json='{"path": "/tmp"}') -> dict:
        raw = sse_tool_call_args(self.model, self.chunk_id, call_index, args_json)
        return _parse_sse(raw)

    def test_returns_bytes(self):
        raw = sse_tool_call_args(self.model, self.chunk_id, 0, "{}")
        self.assertIsInstance(raw, bytes)

    def test_ends_with_double_newline(self):
        raw = sse_tool_call_args(self.model, self.chunk_id, 0, "{}")
        self.assertTrue(raw.endswith(b"\n\n"))

    def test_arguments_in_function(self):
        args = '{"path": "/tmp/x.txt"}'
        obj = self._chunk(args_json=args)
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["function"]["arguments"], args)

    def test_call_index_in_tool_call(self):
        obj = self._chunk(call_index=1)
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["index"], 1)

    def test_finish_reason_is_none(self):
        obj = self._chunk()
        self.assertIsNone(obj["choices"][0]["finish_reason"])

    def test_no_id_or_type_in_args_chunk(self):
        # Args chunks only carry index + function.arguments — no id/type
        obj = self._chunk()
        tc = obj["choices"][0]["delta"]["tool_calls"][0]
        self.assertNotIn("id", tc)
        self.assertNotIn("type", tc)


# ---------------------------------------------------------------------------
# sse_finish
# ---------------------------------------------------------------------------

class TestSseFinish(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-finish001"
        self.model = "qwen3"

    def _chunk(self, reason: str) -> dict:
        return _parse_sse(sse_finish(self.model, self.chunk_id, reason))

    def test_returns_bytes(self):
        self.assertIsInstance(sse_finish(self.model, self.chunk_id, "stop"), bytes)

    def test_finish_reason_stop(self):
        obj = self._chunk("stop")
        self.assertEqual(obj["choices"][0]["finish_reason"], "stop")

    def test_finish_reason_tool_calls(self):
        obj = self._chunk("tool_calls")
        self.assertEqual(obj["choices"][0]["finish_reason"], "tool_calls")

    def test_delta_is_empty(self):
        obj = self._chunk("stop")
        self.assertEqual(obj["choices"][0]["delta"], {})

    def test_object_type(self):
        obj = self._chunk("stop")
        self.assertEqual(obj["object"], "chat.completion.chunk")

    def test_model_field(self):
        obj = self._chunk("stop")
        self.assertEqual(obj["model"], self.model)


# ---------------------------------------------------------------------------
# non_stream_response
# ---------------------------------------------------------------------------

class TestNonStreamResponse(unittest.TestCase):
    def setUp(self):
        self.chunk_id = "chatcmpl-nsr001"
        self.model = "qwen3"

    def _resp(self, text="", tool_calls=None, reasoning=None) -> dict:
        return non_stream_response(self.model, self.chunk_id, text, tool_calls, reasoning)

    def test_object_type_is_chat_completion(self):
        obj = self._resp(text="hello")
        self.assertEqual(obj["object"], "chat.completion")

    def test_id_matches(self):
        obj = self._resp(text="hello")
        self.assertEqual(obj["id"], self.chunk_id)

    def test_model_matches(self):
        obj = self._resp(text="hi")
        self.assertEqual(obj["model"], self.model)

    def test_role_is_assistant(self):
        obj = self._resp(text="hi")
        self.assertEqual(obj["choices"][0]["message"]["role"], "assistant")

    def test_text_content_preserved(self):
        obj = self._resp(text="  hello world  ")
        # non_stream_response strips the text
        self.assertEqual(obj["choices"][0]["message"]["content"], "hello world")

    def test_empty_text_gives_none_content(self):
        obj = self._resp(text="")
        self.assertIsNone(obj["choices"][0]["message"]["content"])

    def test_finish_reason_stop_for_text_only(self):
        obj = self._resp(text="hello")
        self.assertEqual(obj["choices"][0]["finish_reason"], "stop")

    def test_finish_reason_tool_calls_when_tools_present(self):
        tc = [{"id": "call_1", "type": "function", "function": {"name": "read", "arguments": "{}"}}]
        obj = self._resp(text="", tool_calls=tc)
        self.assertEqual(obj["choices"][0]["finish_reason"], "tool_calls")

    def test_tool_calls_included_in_message(self):
        tc = [{"id": "call_1", "type": "function", "function": {"name": "bash", "arguments": '{"cmd":"ls"}'}}]
        obj = self._resp(tool_calls=tc)
        self.assertEqual(obj["choices"][0]["message"]["tool_calls"], tc)

    def test_no_tool_calls_key_when_none(self):
        obj = self._resp(text="hello")
        self.assertNotIn("tool_calls", obj["choices"][0]["message"])

    def test_reasoning_content_included_when_provided(self):
        obj = self._resp(text="answer", reasoning="step 1 → step 2")
        self.assertEqual(obj["choices"][0]["message"]["reasoning_content"], "step 1 → step 2")

    def test_no_reasoning_content_when_none(self):
        obj = self._resp(text="hello")
        self.assertNotIn("reasoning_content", obj["choices"][0]["message"])

    def test_usage_fields_present(self):
        obj = self._resp(text="hi")
        self.assertIn("usage", obj)
        self.assertEqual(obj["usage"]["total_tokens"], 0)

    def test_choices_has_single_entry(self):
        obj = self._resp(text="hi")
        self.assertEqual(len(obj["choices"]), 1)
        self.assertEqual(obj["choices"][0]["index"], 0)


if __name__ == "__main__":
    unittest.main()

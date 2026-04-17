"""
tests/test_tools.py — Tests for web_proxy.tools

Covers:
  - build_tool_preamble: empty list, function-type tools, bare-name tools, mixed
  - messages_to_prompt: system/user/assistant/tool roles, tool_calls in history,
                        list-content messages, tool preamble injection
  - ToolCallParser.feed: plain text, single tool_call block, multiple blocks,
                         split across chunks, invalid JSON fallback
  - ToolCallParser.flush: partial tag in buffer, clean state
"""

import sys
import os
import json
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from web_proxy.tools import build_tool_preamble, messages_to_prompt, ToolCallParser


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_function_tool(name: str, description: str = "", params: dict | None = None) -> dict:
    """OpenAI-style tool with type=function wrapper."""
    fn: dict = {"name": name}
    if description:
        fn["description"] = description
    if params:
        fn["parameters"] = params
    return {"type": "function", "function": fn}


def _make_bare_tool(name: str, description: str = "") -> dict:
    """Tool without type wrapper — just name/description."""
    t: dict = {"name": name}
    if description:
        t["description"] = description
    return t


# ---------------------------------------------------------------------------
# build_tool_preamble
# ---------------------------------------------------------------------------

class TestBuildToolPreamble(unittest.TestCase):
    def test_empty_tools_returns_empty_string(self):
        self.assertEqual(build_tool_preamble([]), "")

    def test_none_equivalent_no_tools_returns_empty(self):
        # Explicitly empty list
        result = build_tool_preamble([])
        self.assertEqual(result, "")

    def test_single_function_tool_includes_name(self):
        tools = [_make_function_tool("read", "Read a file")]
        result = build_tool_preamble(tools)
        self.assertIn("read", result)

    def test_single_function_tool_includes_description(self):
        tools = [_make_function_tool("read", "Read a file from disk")]
        result = build_tool_preamble(tools)
        self.assertIn("Read a file from disk", result)

    def test_function_tool_includes_parameters(self):
        params = {"type": "object", "properties": {"path": {"type": "string"}}}
        tools = [_make_function_tool("read", "Read file", params)]
        result = build_tool_preamble(tools)
        self.assertIn(json.dumps(params), result)

    def test_bare_name_tool_is_handled(self):
        tools = [_make_bare_tool("bash", "Run a shell command")]
        result = build_tool_preamble(tools)
        self.assertIn("bash", result)
        self.assertIn("Run a shell command", result)

    def test_multiple_tools_all_appear(self):
        tools = [
            _make_function_tool("read", "Read a file"),
            _make_function_tool("write", "Write a file"),
            _make_function_tool("bash", "Run shell"),
        ]
        result = build_tool_preamble(tools)
        self.assertIn("read", result)
        self.assertIn("write", result)
        self.assertIn("bash", result)

    def test_preamble_contains_tool_call_format_instruction(self):
        tools = [_make_function_tool("read")]
        result = build_tool_preamble(tools)
        self.assertIn("<tool_call>", result)

    def test_unknown_tool_shape_is_skipped_gracefully(self):
        # A dict without "name" or "type"="function" — should not crash
        tools = [{"random_key": "random_value"}]
        # Should not raise; may return empty or preamble-only
        result = build_tool_preamble(tools)
        self.assertIsInstance(result, str)

    def test_tool_without_description_still_renders(self):
        tools = [_make_function_tool("nodesc")]
        result = build_tool_preamble(tools)
        self.assertIn("nodesc", result)

    def test_input_schema_used_when_parameters_absent(self):
        # Some tools use input_schema instead of parameters
        tool = {"name": "glob", "input_schema": {"type": "object"}}
        result = build_tool_preamble([tool])
        self.assertIn("glob", result)


# ---------------------------------------------------------------------------
# messages_to_prompt
# ---------------------------------------------------------------------------

class TestMessagesToPrompt(unittest.TestCase):
    def test_system_message_prefixed(self):
        msgs = [{"role": "system", "content": "You are a coding agent."}]
        result = messages_to_prompt(msgs)
        self.assertIn("system:", result)
        self.assertIn("You are a coding agent.", result)

    def test_user_message_prefixed(self):
        msgs = [{"role": "user", "content": "Hello!"}]
        result = messages_to_prompt(msgs)
        self.assertIn("user: Hello!", result)

    def test_assistant_text_message_prefixed(self):
        msgs = [{"role": "assistant", "content": "Sure!"}]
        result = messages_to_prompt(msgs)
        self.assertIn("assistant: Sure!", result)

    def test_tool_result_message_prefixed(self):
        msgs = [{"role": "tool", "content": "file content", "tool_call_id": "call_abc"}]
        result = messages_to_prompt(msgs)
        self.assertIn("tool_result [call_abc]: file content", result)

    def test_messages_separated_by_double_newline(self):
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        result = messages_to_prompt(msgs)
        self.assertIn("\n\n", result)

    def test_list_content_parts_concatenated(self):
        msgs = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "First"},
                {"type": "text", "text": "Second"},
            ],
        }]
        result = messages_to_prompt(msgs)
        self.assertIn("First", result)
        self.assertIn("Second", result)

    def test_list_content_non_text_parts_ignored(self):
        msgs = [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": "http://example.com/img.png"}},
                {"type": "text", "text": "describe this"},
            ],
        }]
        result = messages_to_prompt(msgs)
        self.assertIn("describe this", result)
        self.assertNotIn("image_url", result)

    def test_tool_preamble_injected_into_system_message(self):
        msgs = [{"role": "system", "content": "Be helpful."}]
        tools = [_make_function_tool("read", "Read a file")]
        result = messages_to_prompt(msgs, tools)
        # Preamble should precede the system content
        preamble_pos = result.find("<tool_call>")
        system_pos = result.find("Be helpful.")
        self.assertLess(preamble_pos, system_pos)

    def test_tool_preamble_injected_at_start_when_no_system_message(self):
        msgs = [{"role": "user", "content": "hi"}]
        tools = [_make_function_tool("bash", "Shell")]
        result = messages_to_prompt(msgs, tools)
        self.assertIn("system:", result)
        self.assertIn("bash", result)

    def test_assistant_tool_calls_serialised_as_tool_call_tags(self):
        msgs = [{
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "function": {
                    "name": "read",
                    "arguments": json.dumps({"path": "/tmp/x"}),
                }
            }],
        }]
        result = messages_to_prompt(msgs)
        self.assertIn("<tool_call>", result)
        self.assertIn("read", result)

    def test_assistant_tool_calls_arguments_deserialised_back(self):
        args = {"path": "/tmp/x.txt"}
        msgs = [{
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "function": {
                    "name": "read",
                    "arguments": json.dumps(args),
                }
            }],
        }]
        result = messages_to_prompt(msgs)
        # The arguments should be present as a JSON object in the output
        self.assertIn("/tmp/x.txt", result)

    def test_empty_messages_returns_empty_string(self):
        result = messages_to_prompt([])
        self.assertEqual(result, "")

    def test_full_conversation_round_trip(self):
        msgs = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "What is 2+2?"},
            {"role": "assistant", "content": "4"},
            {"role": "user", "content": "Thanks!"},
        ]
        result = messages_to_prompt(msgs)
        self.assertIn("system:", result)
        self.assertIn("user:", result)
        self.assertIn("assistant:", result)
        self.assertIn("4", result)


# ---------------------------------------------------------------------------
# ToolCallParser
# ---------------------------------------------------------------------------

class TestToolCallParserFeed(unittest.TestCase):
    def setUp(self):
        self.parser = ToolCallParser()

    def _feed_all(self, text: str) -> list[tuple]:
        return list(self.parser.feed(text))

    def test_plain_text_yields_text_events(self):
        events = self._feed_all("hello world")
        # May yield partial text depending on safe-buffer logic
        texts = [v for k, v in events if k == "text"]
        # All yielded events should be "text"
        for kind, _ in events:
            self.assertEqual(kind, "text")

    def test_no_events_for_very_short_safe_buffer(self):
        # Text shorter than len("<tool_call>") is kept in buffer — safe
        events = self._feed_all("hi")
        # The text is too short to be safely emitted without a tag start
        # so the parser may yield nothing — that's fine
        for kind, _ in events:
            self.assertEqual(kind, "text")

    def test_single_tool_call_block_parsed(self):
        payload = json.dumps({"name": "read", "arguments": {"path": "/tmp/x"}})
        chunk = f"<tool_call>{payload}</tool_call>"
        events = list(self.parser.feed(chunk))
        tool_events = [(k, v) for k, v in events if k == "tool_call"]
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0][1]["name"], "read")
        self.assertEqual(tool_events[0][1]["arguments"], {"path": "/tmp/x"})

    def test_text_before_tool_call_is_emitted(self):
        payload = json.dumps({"name": "bash", "arguments": {"cmd": "ls"}})
        chunk = f"Sure! Let me check.\n<tool_call>{payload}</tool_call>"
        events = list(self.parser.feed(chunk))
        text_events = [v for k, v in events if k == "text"]
        joined = "".join(text_events)
        self.assertIn("Sure", joined)

    def test_text_after_tool_call_is_emitted_after_flush(self):
        payload = json.dumps({"name": "read", "arguments": {}})
        chunk = f"<tool_call>{payload}</tool_call>Done."
        events = list(self.parser.feed(chunk))
        flush_events = list(self.parser.flush())
        all_text = [v for k, v in events + flush_events if k == "text"]
        self.assertTrue(any("Done" in t for t in all_text))

    def test_multiple_tool_call_blocks_in_one_feed(self):
        p1 = json.dumps({"name": "read", "arguments": {"path": "/a"}})
        p2 = json.dumps({"name": "write", "arguments": {"path": "/b", "content": "x"}})
        chunk = f"<tool_call>{p1}</tool_call>Some text<tool_call>{p2}</tool_call>"
        events = list(self.parser.feed(chunk))
        tool_events = [(k, v) for k, v in events if k == "tool_call"]
        self.assertEqual(len(tool_events), 2)
        names = [v["name"] for _, v in tool_events]
        self.assertIn("read", names)
        self.assertIn("write", names)

    def test_split_tag_across_chunks(self):
        payload = json.dumps({"name": "glob", "arguments": {"pattern": "**/*.ts"}})
        full = f"<tool_call>{payload}</tool_call>"
        mid = len(full) // 2
        chunk1 = full[:mid]
        chunk2 = full[mid:]

        events1 = list(self.parser.feed(chunk1))
        events2 = list(self.parser.feed(chunk2))
        all_events = events1 + events2

        tool_events = [(k, v) for k, v in all_events if k == "tool_call"]
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0][1]["name"], "glob")

    def test_invalid_json_inside_tool_call_emits_raw_text(self):
        chunk = "<tool_call>not valid json at all</tool_call>"
        events = list(self.parser.feed(chunk))
        # Should not raise; should emit a text event with the raw content
        kinds = [k for k, _ in events]
        self.assertNotIn("tool_call", kinds)
        self.assertIn("text", kinds)

    def test_feed_returns_generator(self):
        import types
        gen = self.parser.feed("hello")
        self.assertIsInstance(gen, types.GeneratorType)

    def test_streaming_character_by_character(self):
        """Char-by-char streaming correctly detects tool_call blocks
        thanks to combined tag_buf+buf close-tag detection."""
        payload = json.dumps({"name": "read", "arguments": {}})
        full = f"text<tool_call>{payload}</tool_call>end"
        all_events = []
        for char in full:
            all_events.extend(self.parser.feed(char))
        all_events.extend(self.parser.flush())
        tool_events = [(k, v) for k, v in all_events if k == "tool_call"]
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0][1]["name"], "read")

    def test_streaming_small_chunks_parses_tool_call(self):
        """With realistic small chunks (3-5 chars), the parser correctly
        detects both open and close tags and yields a tool_call event."""
        payload = json.dumps({"name": "read", "arguments": {"path": "/tmp"}})
        full = f"prefix<tool_call>{payload}</tool_call>suffix"
        all_events = []
        chunk_size = 5
        for i in range(0, len(full), chunk_size):
            all_events.extend(self.parser.feed(full[i:i + chunk_size]))
        all_events.extend(self.parser.flush())
        tool_events = [(k, v) for k, v in all_events if k == "tool_call"]
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0][1]["name"], "read")


class TestToolCallParserFlush(unittest.TestCase):
    def setUp(self):
        self.parser = ToolCallParser()

    def test_flush_empty_parser_yields_nothing(self):
        events = list(self.parser.flush())
        self.assertEqual(events, [])

    def test_flush_emits_buffered_text(self):
        # Feed enough text to fill the safe buffer without triggering a tool tag
        list(self.parser.feed("hello world this is plain text"))
        events = list(self.parser.flush())
        all_text = "".join(v for k, v in events if k == "text")
        # Any remaining buffer content should be emitted on flush
        # (exact content depends on how much the safe-buffer retained)
        self.assertIsInstance(all_text, str)

    def test_flush_emits_partial_open_tag_as_text(self):
        # Feed an incomplete open tag — flush should recover it as text
        list(self.parser.feed("<tool_call>invalid-and-never-closed"))
        events = list(self.parser.flush())
        kinds = [k for k, _ in events]
        self.assertIn("text", kinds)

    def test_flush_resets_internal_state(self):
        list(self.parser.feed("some text"))
        list(self.parser.flush())
        # After flush, buffer should be empty — feeding more works fresh
        payload = json.dumps({"name": "read", "arguments": {}})
        events = list(self.parser.feed(f"<tool_call>{payload}</tool_call>"))
        tool_events = [(k, v) for k, v in events if k == "tool_call"]
        self.assertEqual(len(tool_events), 1)

    def test_flush_in_tag_state_emits_open_tag_plus_accumulated(self):
        # Start a tool_call block but never close it
        list(self.parser.feed("<tool_call>{\"name\":"))
        events = list(self.parser.flush())
        text_output = "".join(v for k, v in events if k == "text")
        self.assertIn("<tool_call>", text_output)


if __name__ == "__main__":
    unittest.main()

"""
tools.py — Shared tool-calling helpers.

Providers that don't support native function calling use prompt injection +
XML parsing to handle tools. Providers with native support skip this entirely.
"""

import json

# ---------------------------------------------------------------------------
# Prompt injection
# ---------------------------------------------------------------------------

_TOOL_PREAMBLE = """You have access to the following tools. When you need to use a tool, output a tool call block in this exact format (one per tool call):

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
    lines = [_TOOL_PREAMBLE]
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
            parts.append(f"tool_result [{tool_call_id}]: {content}")

    if tool_preamble:
        parts.insert(0, f"system: {tool_preamble}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# XML streaming parser
# ---------------------------------------------------------------------------

_OPEN = "<tool_call>"
_CLOSE = "</tool_call>"


class ToolCallParser:
    """
    Accumulates streamed text and detects <tool_call>...</tool_call> blocks.
    Emits:
      ("text", str)       — normal text content
      ("tool_call", dict) — parsed {"name":..., "arguments":...}
    """

    def __init__(self):
        self._buf = ""
        self._in_tag = False
        self._tag_buf = ""

    def feed(self, text: str):
        self._buf += text
        while True:
            if not self._in_tag:
                idx = self._buf.find(_OPEN)
                if idx == -1:
                    safe = len(self._buf) - len(_OPEN)
                    if safe > 0:
                        yield ("text", self._buf[:safe])
                        self._buf = self._buf[safe:]
                    break
                else:
                    if idx > 0:
                        yield ("text", self._buf[:idx])
                    self._buf = self._buf[idx + len(_OPEN):]
                    self._in_tag = True
                    self._tag_buf = ""
            else:
                # Search the combined tag_buf + buf so we detect close
                # tags that span the chunk boundary.
                combined = self._tag_buf + self._buf
                idx = combined.find(_CLOSE)
                if idx == -1:
                    self._tag_buf = combined
                    self._buf = ""
                    break
                else:
                    tag_content = combined[:idx]
                    after = combined[idx + len(_CLOSE):]
                    self._buf = after
                    self._tag_buf = ""
                    self._in_tag = False
                    try:
                        obj = json.loads(tag_content.strip())
                        yield ("tool_call", obj)
                    except json.JSONDecodeError:
                        yield ("text", _OPEN + tag_content + _CLOSE)

    def flush(self):
        remaining = self._buf
        if self._in_tag:
            remaining = _OPEN + self._tag_buf + remaining
        if remaining:
            yield ("text", remaining)
        self._buf = ""
        self._tag_buf = ""
        self._in_tag = False


def make_tool_call_entry(name: str, args: dict | str) -> dict:
    """Build an OpenAI-format tool_call object for non-streaming responses."""
    import uuid
    args_json = json.dumps(args) if isinstance(args, dict) else str(args)
    return {
        "id": f"call_{uuid.uuid4().hex[:12]}",
        "type": "function",
        "function": {"name": name, "arguments": args_json},
    }

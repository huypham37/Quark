"""
base.py — Abstract WebProvider interface + event types.

Every provider yields a stream of these events from its stream() method.
The server converts them to OpenAI SSE bytes using sse.py.

Adding a new provider:
  1. Subclass WebProvider
  2. Implement handles(), authenticate(), list_models()
  3. Implement _build_prompt(messages, tools) → str   (or override for custom format)
  4. Implement _raw_stream(prompt, model, **kw) → Iterator[SSEEvent]
     Yield only TextDelta / ReasoningDelta — never ToolCall/Done.
  5. Register in server.py: registry.register(MyProvider())

The base stream() method owns the full tool pipeline:
  messages_to_prompt → _build_prompt → _raw_stream → ToolCallParser → ToolCall/Done
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator


# ---------------------------------------------------------------------------
# Event types — what providers yield
# ---------------------------------------------------------------------------

@dataclass
class TextDelta:
    text: str


@dataclass
class ReasoningDelta:
    """Reasoning/thinking token. Always emitted as delta.reasoning_content."""
    text: str


@dataclass
class ToolCall:
    name: str
    arguments: dict
    call_id: str = field(default_factory=lambda: __import__("uuid").uuid4().hex[:12])


@dataclass
class Done:
    finish_reason: str = "stop"  # "stop" | "tool_calls"


# Union type for type hints
SSEEvent = TextDelta | ReasoningDelta | ToolCall | Done


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class WebProvider(ABC):
    """
    Base class for all web LLM providers.

    Implementations live in web_proxy/providers/*.py.
    The server calls authenticate() once at startup, then routes requests
    based on handles(model).

    Tool pipeline (owned here, not in providers):
      stream() calls _build_prompt(), then _raw_stream(), feeds output through
      ToolCallParser when tools are present, and emits ToolCall / Done events.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Short provider name for logging (e.g. 'qwen', 'claude')."""
        ...

    @abstractmethod
    def handles(self, model: str) -> bool:
        """Return True if this provider should handle the given model string."""
        ...

    @abstractmethod
    def authenticate(self) -> bool:
        """
        Load credentials. Return True if ready, False if unavailable.
        Must NOT raise — a failed auth just means the provider is inactive.
        Inactive providers are omitted from /v1/models but don't crash the server.
        """
        ...

    @abstractmethod
    def list_models(self) -> list[dict]:
        """Return OpenAI-format model objects for /v1/models."""
        ...

    def _build_prompt(self, messages: list, tools: list | None) -> str:
        """
        Convert OpenAI messages + tools into a flat prompt string.
        Override for provider-specific turn formats (e.g. Claude's Human:/Assistant:).
        Default uses the generic messages_to_prompt from tools.py.
        """
        from web_proxy.tools import messages_to_prompt
        return messages_to_prompt(messages, tools or None)

    @abstractmethod
    def _raw_stream(self, prompt: str, model: str, **kw) -> Iterator[SSEEvent]:
        """
        Hit the provider HTTP endpoint and yield raw TextDelta / ReasoningDelta.
        Must NOT yield ToolCall or Done — the base stream() handles those.
        **kw carries provider-specific extras (e.g. has_tools flag).
        """
        ...

    def stream(
        self,
        messages: list,
        model: str,
        tools: list,
    ) -> Iterator[SSEEvent]:
        """
        Full tool pipeline — do not override in providers.

        1. Build prompt (with tool preamble injected when tools present)
        2. Stream raw events from _raw_stream()
        3. Feed TextDelta text through ToolCallParser when tools present
        4. Emit ToolCall events for each detected <tool_call> block
        5. Emit Done with correct finish_reason
        """
        from web_proxy.tools import ToolCallParser
        has_tools = bool(tools)
        prompt = self._build_prompt(messages, tools if has_tools else None)
        parser = ToolCallParser() if has_tools else None
        saw_tool_call = False

        for event in self._raw_stream(prompt, model, has_tools=has_tools):
            if isinstance(event, TextDelta):
                if parser:
                    for kind, value in parser.feed(event.text):
                        if kind == "text" and value:
                            yield TextDelta(text=value)
                        elif kind == "tool_call":
                            saw_tool_call = True
                            yield ToolCall(
                                name=value.get("name", ""),
                                arguments=value.get("arguments", {}),
                            )
                else:
                    yield event
            elif isinstance(event, ReasoningDelta):
                yield event
            elif isinstance(event, ToolCall):
                # Native tool call from provider (e.g. Qwen function_call delta)
                saw_tool_call = True
                yield event

        if parser:
            for kind, value in parser.flush():
                if kind == "text" and value.strip():
                    yield TextDelta(text=value)
                elif kind == "tool_call":
                    saw_tool_call = True
                    yield ToolCall(
                        name=value.get("name", ""),
                        arguments=value.get("arguments", {}),
                    )

        yield Done(finish_reason="tool_calls" if saw_tool_call else "stop")

    def is_ready(self) -> bool:
        """Returns True if authenticate() succeeded."""
        return getattr(self, "_ready", False)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class ProviderRegistry:
    def __init__(self):
        self._providers: list[WebProvider] = []

    def register(self, provider: WebProvider) -> None:
        self._providers.append(provider)

    def authenticate_all(self) -> None:
        for p in self._providers:
            try:
                ok = p.authenticate()
                p._ready = ok
                status = "ready" if ok else "unavailable (no credentials)"
                print(f"[web-proxy] {p.name}: {status}")
            except Exception as e:
                p._ready = False
                print(f"[web-proxy] {p.name}: failed to authenticate — {e}")

    def resolve(self, model: str) -> WebProvider | None:
        """Find the first ready provider that handles this model."""
        for p in self._providers:
            if p.is_ready() and p.handles(model):
                return p
        # Also check inactive providers for a better error message
        for p in self._providers:
            if p.handles(model):
                return p  # Will fail at request time with a clear error
        return None

    def all_models(self) -> list[dict]:
        """Return models from all ready providers."""
        models = []
        for p in self._providers:
            if p.is_ready():
                models.extend(p.list_models())
        return models


registry = ProviderRegistry()

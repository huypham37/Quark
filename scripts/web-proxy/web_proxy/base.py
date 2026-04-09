"""
base.py — Abstract WebProvider interface + event types.

Every provider yields a stream of these events from its stream() method.
The server converts them to OpenAI SSE bytes using sse.py.

Adding a new provider:
  1. Subclass WebProvider
  2. Implement handles(), authenticate(), list_models(), stream()
  3. Register in server.py: registry.register(MyProvider())
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

    @abstractmethod
    def stream(
        self,
        messages: list,
        model: str,
        tools: list,
    ) -> Iterator[SSEEvent]:
        """
        Yield SSEEvents for the given request.

        Args:
            messages: OpenAI-format message list
            model:    Model ID (provider prefix already stripped)
            tools:    OpenAI-format tool list (may be empty)
        """
        ...

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

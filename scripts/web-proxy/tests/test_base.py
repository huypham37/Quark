"""
tests/test_base.py — Tests for web_proxy.base

Covers:
  - ProviderRegistry.register / resolve / authenticate_all / all_models
  - WebProvider.is_ready() state
  - resolve() ready-first semantics (prefers ready over inactive)
  - all_models() only aggregates ready providers
  - authenticate_all() handles provider exceptions gracefully
"""

import sys
import os
import unittest

# ---------------------------------------------------------------------------
# Minimal concrete WebProvider for testing — no network calls
# ---------------------------------------------------------------------------

# Make sure the package is importable when running from repo root or tests/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from web_proxy.base import WebProvider, ProviderRegistry, TextDelta, ReasoningDelta, ToolCall, Done


class FakeProvider(WebProvider):
    """Configurable stub that satisfies the WebProvider interface."""

    def __init__(
        self,
        name: str = "fake",
        handles_prefix: str = "fake",
        auth_result: bool = True,
        models: list | None = None,
        raise_on_auth: Exception | None = None,
    ):
        self._name = name
        self._handles_prefix = handles_prefix
        self._auth_result = auth_result
        self._models = models or [{"id": f"{name}/model-1", "object": "model", "created": 0, "owned_by": name}]
        self._raise_on_auth = raise_on_auth

    @property
    def name(self) -> str:
        return self._name

    def handles(self, model: str) -> bool:
        return model.startswith(self._handles_prefix)

    def authenticate(self) -> bool:
        if self._raise_on_auth is not None:
            raise self._raise_on_auth
        return self._auth_result

    def list_models(self) -> list[dict]:
        return self._models

    def _raw_stream(self, prompt, model, **kw):
        yield TextDelta(text="hello")


# ---------------------------------------------------------------------------
# ProviderRegistry tests
# ---------------------------------------------------------------------------

class TestProviderRegistryRegister(unittest.TestCase):
    def setUp(self):
        self.registry = ProviderRegistry()

    def test_register_adds_provider(self):
        p = FakeProvider("alpha", "alpha")
        self.registry.register(p)
        self.assertIn(p, self.registry._providers)

    def test_register_multiple_providers(self):
        p1 = FakeProvider("a", "a")
        p2 = FakeProvider("b", "b")
        self.registry.register(p1)
        self.registry.register(p2)
        self.assertEqual(len(self.registry._providers), 2)

    def test_register_preserves_insertion_order(self):
        providers = [FakeProvider(f"p{i}", f"p{i}") for i in range(3)]
        for p in providers:
            self.registry.register(p)
        self.assertEqual(self.registry._providers, providers)


class TestProviderRegistryAuthenticateAll(unittest.TestCase):
    def setUp(self):
        self.registry = ProviderRegistry()

    def test_authenticate_all_sets_ready_true_on_success(self):
        p = FakeProvider("ok", "ok", auth_result=True)
        self.registry.register(p)
        self.registry.authenticate_all()
        self.assertTrue(p._ready)

    def test_authenticate_all_sets_ready_false_on_failure(self):
        p = FakeProvider("bad", "bad", auth_result=False)
        self.registry.register(p)
        self.registry.authenticate_all()
        self.assertFalse(p._ready)

    def test_authenticate_all_handles_exceptions_gracefully(self):
        p = FakeProvider("boom", "boom", raise_on_auth=RuntimeError("network error"))
        self.registry.register(p)
        # Must not raise
        self.registry.authenticate_all()
        self.assertFalse(p._ready)

    def test_authenticate_all_continues_after_one_failure(self):
        p1 = FakeProvider("bad", "bad", raise_on_auth=RuntimeError("fail"))
        p2 = FakeProvider("good", "good", auth_result=True)
        self.registry.register(p1)
        self.registry.register(p2)
        self.registry.authenticate_all()
        self.assertFalse(p1._ready)
        self.assertTrue(p2._ready)

    def test_authenticate_all_with_empty_registry(self):
        # Should not raise
        self.registry.authenticate_all()


class TestProviderRegistryResolve(unittest.TestCase):
    def setUp(self):
        self.registry = ProviderRegistry()

    def _make_ready(self, provider: FakeProvider) -> FakeProvider:
        provider._ready = True
        return provider

    def _make_inactive(self, provider: FakeProvider) -> FakeProvider:
        provider._ready = False
        return provider

    def test_resolve_returns_ready_provider_that_handles_model(self):
        p = self._make_ready(FakeProvider("qwen", "qwen"))
        self.registry.register(p)
        result = self.registry.resolve("qwen3-max")
        self.assertIs(result, p)

    def test_resolve_returns_none_when_no_provider_handles_model(self):
        p = self._make_ready(FakeProvider("qwen", "qwen"))
        self.registry.register(p)
        result = self.registry.resolve("claude-sonnet")
        self.assertIsNone(result)

    def test_resolve_skips_inactive_provider_when_ready_one_exists(self):
        inactive = self._make_inactive(FakeProvider("qwen-old", "qwen"))
        ready = self._make_ready(FakeProvider("qwen-new", "qwen"))
        self.registry.register(inactive)
        self.registry.register(ready)
        # First pass finds the ready one
        result = self.registry.resolve("qwen3")
        self.assertIs(result, ready)

    def test_resolve_falls_back_to_inactive_provider_for_better_error(self):
        # When no ready provider handles the model, but an inactive one does,
        # resolve() returns the inactive one (so the server can give a clear error).
        inactive = self._make_inactive(FakeProvider("qwen", "qwen"))
        self.registry.register(inactive)
        result = self.registry.resolve("qwen3")
        self.assertIs(result, inactive)

    def test_resolve_first_ready_provider_wins(self):
        p1 = self._make_ready(FakeProvider("alpha", "shared"))
        p2 = self._make_ready(FakeProvider("beta", "shared"))
        self.registry.register(p1)
        self.registry.register(p2)
        result = self.registry.resolve("shared-model")
        self.assertIs(result, p1)

    def test_resolve_with_empty_registry(self):
        result = self.registry.resolve("any-model")
        self.assertIsNone(result)


class TestProviderRegistryAllModels(unittest.TestCase):
    def setUp(self):
        self.registry = ProviderRegistry()

    def test_all_models_returns_models_from_ready_providers(self):
        p = FakeProvider("qwen", "qwen", models=[{"id": "web/qwen3", "object": "model", "created": 0, "owned_by": "qwen"}])
        p._ready = True
        self.registry.register(p)
        models = self.registry.all_models()
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0]["id"], "web/qwen3")

    def test_all_models_excludes_inactive_providers(self):
        ready = FakeProvider("ready", "ready", models=[{"id": "web/ready-model", "object": "model", "created": 0, "owned_by": "ready"}])
        inactive = FakeProvider("inactive", "inactive", models=[{"id": "web/inactive-model", "object": "model", "created": 0, "owned_by": "inactive"}])
        ready._ready = True
        inactive._ready = False
        self.registry.register(ready)
        self.registry.register(inactive)
        models = self.registry.all_models()
        ids = [m["id"] for m in models]
        self.assertIn("web/ready-model", ids)
        self.assertNotIn("web/inactive-model", ids)

    def test_all_models_aggregates_from_multiple_ready_providers(self):
        p1 = FakeProvider("a", "a", models=[{"id": "web/a-1", "object": "model", "created": 0, "owned_by": "a"}])
        p2 = FakeProvider("b", "b", models=[{"id": "web/b-1", "object": "model", "created": 0, "owned_by": "b"},
                                             {"id": "web/b-2", "object": "model", "created": 0, "owned_by": "b"}])
        p1._ready = True
        p2._ready = True
        self.registry.register(p1)
        self.registry.register(p2)
        models = self.registry.all_models()
        self.assertEqual(len(models), 3)

    def test_all_models_returns_empty_list_when_no_ready_providers(self):
        p = FakeProvider("inactive", "inactive")
        p._ready = False
        self.registry.register(p)
        self.assertEqual(self.registry.all_models(), [])

    def test_all_models_returns_empty_list_on_empty_registry(self):
        self.assertEqual(self.registry.all_models(), [])


# ---------------------------------------------------------------------------
# WebProvider.is_ready() tests
# ---------------------------------------------------------------------------

class TestWebProviderIsReady(unittest.TestCase):
    def test_is_ready_false_before_authenticate_all(self):
        p = FakeProvider("p", "p")
        # _ready not set yet — is_ready() should return False
        self.assertFalse(p.is_ready())

    def test_is_ready_true_after_successful_auth(self):
        p = FakeProvider("p", "p", auth_result=True)
        registry = ProviderRegistry()
        registry.register(p)
        registry.authenticate_all()
        self.assertTrue(p.is_ready())

    def test_is_ready_false_after_failed_auth(self):
        p = FakeProvider("p", "p", auth_result=False)
        registry = ProviderRegistry()
        registry.register(p)
        registry.authenticate_all()
        self.assertFalse(p.is_ready())


# ---------------------------------------------------------------------------
# Event dataclass sanity checks
# ---------------------------------------------------------------------------

class TestEventDataclasses(unittest.TestCase):
    def test_text_delta_stores_text(self):
        e = TextDelta(text="hello")
        self.assertEqual(e.text, "hello")

    def test_reasoning_delta_stores_text(self):
        e = ReasoningDelta(text="thinking...")
        self.assertEqual(e.text, "thinking...")

    def test_tool_call_stores_name_and_arguments(self):
        tc = ToolCall(name="read", arguments={"path": "/tmp/x"})
        self.assertEqual(tc.name, "read")
        self.assertEqual(tc.arguments, {"path": "/tmp/x"})

    def test_tool_call_generates_call_id_automatically(self):
        tc = ToolCall(name="read", arguments={})
        self.assertIsNotNone(tc.call_id)
        self.assertTrue(len(tc.call_id) > 0)

    def test_tool_call_call_ids_are_unique(self):
        ids = {ToolCall(name="x", arguments={}).call_id for _ in range(20)}
        self.assertEqual(len(ids), 20)

    def test_done_default_finish_reason_is_stop(self):
        d = Done()
        self.assertEqual(d.finish_reason, "stop")

    def test_done_accepts_tool_calls_finish_reason(self):
        d = Done(finish_reason="tool_calls")
        self.assertEqual(d.finish_reason, "tool_calls")


if __name__ == "__main__":
    unittest.main()

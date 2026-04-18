"""
tests/test_auth.py — Tests for web_proxy.auth.load_token_file

Covers:
  - Env var takes priority over file
  - File is read when env var is absent
  - Raises RuntimeError when neither env var nor file is present
  - Raises RuntimeError when file exists but is malformed JSON
  - Raises RuntimeError when file exists but the key is missing/empty
  - Works when the token file contains extra keys alongside the target key
"""

import sys
import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from web_proxy.auth import load_token_file


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_token_file(directory: Path, filename: str, data: dict) -> Path:
    """Write a JSON token file into directory/filename and return its path."""
    path = directory / filename
    path.write_text(json.dumps(data))
    return path


# ---------------------------------------------------------------------------
# load_token_file tests
# ---------------------------------------------------------------------------

class TestLoadTokenFileEnvVar(unittest.TestCase):
    """Env var has highest priority — used even when a token file also exists."""

    def test_env_var_returns_token(self):
        with patch.dict(os.environ, {"MY_AUTH_TOKEN": "env-secret"}):
            result = load_token_file("irrelevant.json", "token", "MY_AUTH_TOKEN")
        self.assertEqual(result, "env-secret")

    def test_env_var_priority_over_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "my-token.json", {"token": "file-secret"})
            # Patch both CONFIG_DIR and the env var
            with patch("web_proxy.auth.CONFIG_DIR", tmp), \
                 patch.dict(os.environ, {"MY_AUTH_TOKEN": "env-wins"}):
                result = load_token_file("my-token.json", "token", "MY_AUTH_TOKEN")
        self.assertEqual(result, "env-wins")

    def test_env_var_empty_string_is_falsy_falls_through_to_file(self):
        """An empty env var is treated as unset — falls through to file lookup."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {"token": "file-token"})
            with patch("web_proxy.auth.CONFIG_DIR", tmp), \
                 patch.dict(os.environ, {"MY_AUTH_TOKEN": ""}):
                result = load_token_file("tok.json", "token", "MY_AUTH_TOKEN")
        self.assertEqual(result, "file-token")


class TestLoadTokenFileFromFile(unittest.TestCase):
    """File-based loading when env var is absent."""

    def test_reads_token_from_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "qwen-token.json", {"token": "file-secret-abc"})
            with patch("web_proxy.auth.CONFIG_DIR", tmp), \
                 patch.dict(os.environ, {}, clear=False):
                # Ensure env var is absent
                os.environ.pop("QWEN_AUTH_TOKEN", None)
                result = load_token_file("qwen-token.json", "token", "QWEN_AUTH_TOKEN")
        self.assertEqual(result, "file-secret-abc")

    def test_reads_token_with_custom_key(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "claude-token.json", {"access_token": "claude-xyz"})
            os.environ.pop("CLAUDE_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                result = load_token_file("claude-token.json", "access_token", "CLAUDE_TOKEN")
        self.assertEqual(result, "claude-xyz")

    def test_file_with_extra_keys_still_works(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {
                "token": "real-token",
                "refresh_token": "other",
                "expires_at": 9999,
            })
            os.environ.pop("SOME_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                result = load_token_file("tok.json", "token", "SOME_TOKEN")
        self.assertEqual(result, "real-token")


class TestLoadTokenFileMissing(unittest.TestCase):
    """RuntimeError when no source provides a token."""

    def test_raises_when_no_env_var_and_no_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            os.environ.pop("MISSING_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError) as ctx:
                    load_token_file("nonexistent.json", "token", "MISSING_TOKEN")
        self.assertIn("MISSING_TOKEN", str(ctx.exception))

    def test_error_message_mentions_env_var_name(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            os.environ.pop("MY_SPECIAL_VAR", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError) as ctx:
                    load_token_file("tok.json", "token", "MY_SPECIAL_VAR")
        self.assertIn("MY_SPECIAL_VAR", str(ctx.exception))

    def test_error_message_mentions_file_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            os.environ.pop("MY_SPECIAL_VAR", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError) as ctx:
                    load_token_file("expected-file.json", "token", "MY_SPECIAL_VAR")
        self.assertIn("expected-file.json", str(ctx.exception))


class TestLoadTokenFileMalformed(unittest.TestCase):
    """Token file exists but is unusable — should fall through to RuntimeError."""

    def test_malformed_json_raises_runtime_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            (tmp / "bad.json").write_text("this is not json!!!")
            os.environ.pop("BAD_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError):
                    load_token_file("bad.json", "token", "BAD_TOKEN")

    def test_missing_key_raises_runtime_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {"other_key": "value"})
            os.environ.pop("NO_KEY_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError):
                    load_token_file("tok.json", "token", "NO_KEY_TOKEN")

    def test_empty_string_value_raises_runtime_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {"token": ""})
            os.environ.pop("EMPTY_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError):
                    load_token_file("tok.json", "token", "EMPTY_TOKEN")

    def test_null_value_raises_runtime_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {"token": None})
            os.environ.pop("NULL_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError):
                    load_token_file("tok.json", "token", "NULL_TOKEN")

    def test_empty_json_object_raises_runtime_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            _write_token_file(tmp, "tok.json", {})
            os.environ.pop("EMPTY_OBJ_TOKEN", None)
            with patch("web_proxy.auth.CONFIG_DIR", tmp):
                with self.assertRaises(RuntimeError):
                    load_token_file("tok.json", "token", "EMPTY_OBJ_TOKEN")


if __name__ == "__main__":
    unittest.main()

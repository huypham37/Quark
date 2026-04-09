"""
auth.py — Common auth helpers shared across providers.

Each provider has its own token format / location, but the loading
pattern is always: env var → token file → raise RuntimeError.
"""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "quark"


def load_token_file(filename: str, key: str, env_var: str) -> str:
    """
    Generic token loader.

    Priority: env_var → CONFIG_DIR/filename (JSON with `key` field) → RuntimeError.

    Args:
        filename: JSON file under ~/.config/quark/ (e.g. "qwen-web-proxy-token.json")
        key:      JSON field name holding the token (e.g. "token")
        env_var:  Environment variable name (e.g. "QWEN_AUTH_TOKEN")
    """
    value = os.environ.get(env_var)
    if value:
        return value

    token_file = CONFIG_DIR / filename
    if token_file.exists():
        try:
            data = json.loads(token_file.read_text())
            if data.get(key):
                return data[key]
        except Exception:
            pass

    raise RuntimeError(
        f"No token found for {env_var}.\n"
        f"Set the {env_var!r} environment variable, or save to:\n"
        f"  {token_file}\n"
        f'  {{"{key}": "<your token>"}}'
    )

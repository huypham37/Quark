"""
run.py — Entry point for the unified web-proxy.

Usage:
    python run.py
    python -m web_proxy

Config:
    WEB_PROXY_PORT   Port to listen on (default: 4320)
    WEB_PROXY_HOST   Host to bind to (default: 127.0.0.1)
"""

from __future__ import annotations

import os
from http.server import HTTPServer

from web_proxy.base import registry
from web_proxy.providers.qwen import QwenProvider
from web_proxy.providers.claude import ClaudeProvider
from web_proxy.providers.perplexity import PerplexityProvider
from web_proxy.providers.meta import MetaProvider
from web_proxy.server import Handler


def main():
    # Register all providers — order determines routing priority for overlapping handles()
    registry.register(QwenProvider())
    registry.register(ClaudeProvider())
    registry.register(PerplexityProvider())
    registry.register(MetaProvider())

    # Authenticate all — failed providers stay inactive but don't crash
    print("[web-proxy] Authenticating providers...")
    registry.authenticate_all()

    host = os.environ.get("WEB_PROXY_HOST", "127.0.0.1")
    port = int(os.environ.get("WEB_PROXY_PORT", "4320"))

    print(f"[web-proxy] Starting on http://{host}:{port}")
    print(f"[web-proxy] Endpoint : http://{host}:{port}/v1/chat/completions")
    print(f"[web-proxy] Models   : http://{host}:{port}/v1/models")
    print(f"[web-proxy] Health   : http://{host}:{port}/health")

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[web-proxy] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()

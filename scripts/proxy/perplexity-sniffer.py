"""
perplexity-sniffer.py — mitmproxy addon to capture Perplexity model IDs

Usage:
    mitmdump -s scripts/proxy/perplexity-sniffer.py -p 8080

Then set your browser's HTTP proxy to localhost:8080, go to perplexity.ai,
switch models, and send queries. This script logs the model_preference value
from each request.
"""

import json


class PerplexitySniffer:
    def request(self, flow):
        if "perplexity.ai" not in flow.request.pretty_host:
            return
        if "perplexity_ask" not in flow.request.pretty_url:
            return

        try:
            body = json.loads(flow.request.get_text())
            params = body.get("params", {})
            model = params.get("model_preference", "???")
            query = body.get("query_str", params.get("dsl_query", ""))[:80]
            mode = params.get("mode", "???")
            print(f"\n{'='*60}")
            print(f"  model_preference : {model}")
            print(f"  mode             : {mode}")
            print(f"  query            : {query!r}")
            print(f"{'='*60}")
        except Exception as e:
            print(f"[sniffer] parse error: {e}")


addons = [PerplexitySniffer()]

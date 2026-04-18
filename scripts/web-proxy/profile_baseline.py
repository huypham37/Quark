#!/usr/bin/env python3
"""
profile_baseline.py — Experiment 2: Direct provider baseline.

Calls each provider's stream() directly (no HTTP server, no SSE conversion).
Measures the raw provider speed as a baseline to compare against Experiment 1.

Usage:
    python profile_baseline.py                    # All authenticated providers
    python profile_baseline.py --provider qwen    # Specific provider
    python profile_baseline.py --prompt short      # Specific prompt
    python profile_baseline.py --runs 5            # More runs for stability
"""

from __future__ import annotations

import argparse
import json
import time
import statistics
from pathlib import Path

from web_proxy.base import registry, TextDelta, ReasoningDelta, ToolCall, Done
from web_proxy.providers.qwen import QwenProvider
from web_proxy.providers.claude import ClaudeProvider
from web_proxy.providers.perplexity import PerplexityProvider
from web_proxy.providers.meta import MetaProvider

# ---------------------------------------------------------------------------
# Test prompts
# ---------------------------------------------------------------------------

PROMPTS = {
    "short": {
        "messages": [{"role": "user", "content": "What is 2+2? Answer in one word."}],
        "description": "Minimal latency — isolates setup overhead",
    },
    "medium": {
        "messages": [{"role": "user", "content": "Explain the difference between TCP and UDP in 3 paragraphs."}],
        "description": "Typical response length",
    },
    "long": {
        "messages": [{"role": "user", "content": "Write a Python implementation of a basic HTTP server with routing, explain each part."}],
        "description": "Long streaming response",
    },
    "reasoning": {
        "messages": [{"role": "user", "content": "Think step by step: what is 127 * 43?"}],
        "description": "Reasoning token path",
    },
    "tools": {
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is the weather in San Francisco and the current time?"},
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get weather for a location",
                    "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_time",
                    "description": "Get current time for a timezone",
                    "parameters": {"type": "object", "properties": {"timezone": {"type": "string"}}, "required": ["timezone"]},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "search_web",
                    "description": "Search the web for information",
                    "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
                },
            },
        ],
        "description": "Tool preamble + XML parsing overhead",
    },
}

# Model to use for each provider
PROVIDER_MODELS = {
    "qwen": "qwen3-max",
    "claude": "claude-sonnet-4-5",
    "perplexity": "perplexity",
    "meta": "meta-ai",
}

# ---------------------------------------------------------------------------
# Log directory
# ---------------------------------------------------------------------------

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "proxy-profile"


def ensure_log_dir() -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR


# ---------------------------------------------------------------------------
# Run a single profiled stream
# ---------------------------------------------------------------------------

def profile_provider_stream(
    provider,
    messages: list,
    model: str,
    tools: list,
    prompt_id: str,
) -> dict:
    """Run a provider stream and collect timing metrics."""

    t_start = time.monotonic()
    t_first_event = None
    t_first_text = None
    t_first_reasoning = None
    chunk_timestamps: list[float] = []
    chunk_gaps: list[float] = []

    event_count = 0
    text_count = 0
    reasoning_count = 0
    tool_count = 0
    total_chars = 0

    try:
        for event in provider.stream(messages, model, tools):
            now = time.monotonic()
            event_count += 1

            if chunk_timestamps:
                chunk_gaps.append((now - chunk_timestamps[-1]) * 1000)
            chunk_timestamps.append(now)

            if t_first_event is None:
                t_first_event = now

            if isinstance(event, TextDelta):
                text_count += 1
                total_chars += len(event.text)
                if t_first_text is None:
                    t_first_text = now
            elif isinstance(event, ReasoningDelta):
                reasoning_count += 1
                total_chars += len(event.text)
                if t_first_reasoning is None:
                    t_first_reasoning = now
            elif isinstance(event, ToolCall):
                tool_count += 1
            elif isinstance(event, Done):
                break

    except Exception as e:
        print(f"  ERROR: {e}")
        return {"error": str(e)}

    t_end = time.monotonic()
    duration_s = t_end - t_start

    gap_stats = _gap_stats(chunk_gaps)
    tokens_approx = total_chars // 4 if total_chars else text_count

    return {
        "experiment": 2,
        "provider": provider.name,
        "model": model,
        "prompt_id": prompt_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "metrics": {
            "t_first_event_ms": round((t_first_event - t_start) * 1000, 2) if t_first_event else None,
            "t_first_text_ms": round((t_first_text - t_start) * 1000, 2) if t_first_text else None,
            "t_first_reasoning_ms": round((t_first_reasoning - t_start) * 1000, 2) if t_first_reasoning else None,
            "t_total_ms": round(duration_s * 1000, 2),
            "chunk_gaps_ms": gap_stats,
            "event_count": event_count,
            "text_event_count": text_count,
            "reasoning_event_count": reasoning_count,
            "tool_call_count": tool_count,
            "total_chars": total_chars,
            "tokens_approx": tokens_approx,
            "throughput_tps": round(tokens_approx / duration_s, 1) if duration_s > 0 else 0,
        },
    }


def _gap_stats(gaps: list[float]) -> dict:
    if not gaps:
        return {"min": 0, "max": 0, "avg": 0, "median": 0, "p95": 0, "p99": 0, "count": 0}
    gaps_sorted = sorted(gaps)
    n = len(gaps_sorted)
    return {
        "min": round(gaps_sorted[0], 2),
        "max": round(gaps_sorted[-1], 2),
        "avg": round(statistics.mean(gaps_sorted), 2),
        "median": round(statistics.median(gaps_sorted), 2),
        "p95": round(gaps_sorted[int(n * 0.95)] if n > 1 else gaps_sorted[0], 2),
        "p99": round(gaps_sorted[int(n * 0.99)] if n > 1 else gaps_sorted[0], 2),
        "count": n,
    }


# ---------------------------------------------------------------------------
# Print summary
# ---------------------------------------------------------------------------

def print_result(result: dict):
    if "error" in result:
        print(f"  ❌ Error: {result['error']}")
        return

    m = result["metrics"]
    print(f"  ┌─ {result['provider']} / {result['model']} / prompt={result.get('prompt_id', '?')}")
    print(f"  │  First event     : {m['t_first_event_ms'] or 0:>8.1f} ms")
    print(f"  │  First text      : {m['t_first_text_ms'] or 0:>8.1f} ms")
    print(f"  │  First reasoning : {m['t_first_reasoning_ms'] or 0:>8.1f} ms")
    print(f"  │  Total           : {m['t_total_ms']:>8.1f} ms")
    gaps = m["chunk_gaps_ms"]
    print(f"  │  Chunk gaps      : avg={gaps['avg']:.0f}ms p95={gaps['p95']:.0f}ms max={gaps['max']:.0f}ms")
    print(f"  │  Events          : {m['event_count']} ({m['text_event_count']} text, {m['reasoning_event_count']} reasoning, {m['tool_call_count']} tools)")
    print(f"  │  Throughput      : {m['throughput_tps']:.0f} tokens/sec ({m['total_chars']} chars)")
    print(f"  └──────────────────────────────────────")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Profile web-proxy providers directly (Experiment 2)")
    parser.add_argument("--provider", choices=["qwen", "claude", "perplexity", "meta"], help="Only test this provider")
    parser.add_argument("--prompt", choices=list(PROMPTS.keys()), help="Only run this prompt")
    parser.add_argument("--runs", type=int, default=3, help="Number of runs per combination (default: 3)")
    args = parser.parse_args()

    # Register and authenticate
    providers_map = {
        "qwen": QwenProvider(),
        "claude": ClaudeProvider(),
        "perplexity": PerplexityProvider(),
        "meta": MetaProvider(),
    }

    for name, p in providers_map.items():
        registry.register(p)

    print("[baseline] Authenticating providers...")
    registry.authenticate_all()

    ready = {name: p for name, p in providers_map.items() if p.is_ready()}
    if not ready:
        print("[baseline] No providers authenticated. Check your tokens.")
        return

    print(f"[baseline] Ready providers: {list(ready.keys())}")

    # Filter
    if args.provider:
        if args.provider not in ready:
            print(f"[baseline] Provider '{args.provider}' is not ready.")
            return
        ready = {args.provider: ready[args.provider]}

    prompt_ids = [args.prompt] if args.prompt else list(PROMPTS.keys())

    # Run experiments
    log_dir = ensure_log_dir()
    ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    all_results = []

    for provider_name, provider in ready.items():
        model = PROVIDER_MODELS[provider_name]
        for prompt_id in prompt_ids:
            prompt_def = PROMPTS[prompt_id]
            messages = prompt_def["messages"]
            tools = prompt_def.get("tools", [])

            # Skip tools prompt for providers that don't support tools
            if tools and provider_name in ("perplexity", "meta"):
                print(f"\n[baseline] Skipping {provider_name}/{prompt_id} (tools not supported)")
                continue

            print(f"\n{'='*60}")
            print(f"[baseline] {provider_name} / {model} / prompt={prompt_id}")
            print(f"[baseline] {prompt_def['description']}")
            print(f"{'='*60}")

            for run in range(1, args.runs + 1):
                print(f"\n  Run {run}/{args.runs}:")
                result = profile_provider_stream(provider, messages, model, tools, prompt_id)
                result["run"] = run
                all_results.append(result)
                print_result(result)

                # Small delay between runs
                if run < args.runs:
                    time.sleep(1)

    # Write results
    outfile = log_dir / f"experiment-2-baseline-{ts}.jsonl"
    with open(outfile, "w") as f:
        for r in all_results:
            f.write(json.dumps(r) + "\n")
    print(f"\n[baseline] Results written to {outfile}")

    # Print aggregate comparison
    _print_aggregate(all_results)


def _print_aggregate(results: list[dict]):
    """Print aggregated comparison across providers."""
    print(f"\n{'='*60}")
    print(f"  AGGREGATE COMPARISON (Experiment 2 — Direct Baseline)")
    print(f"{'='*60}")

    by_provider: dict[str, list[dict]] = {}
    for r in results:
        if "error" not in r:
            by_provider.setdefault(r["provider"], []).append(r)

    for provider, runs in sorted(by_provider.items()):
        ttfts = [r["metrics"]["t_first_text_ms"] for r in runs if r["metrics"]["t_first_text_ms"]]
        totals = [r["metrics"]["t_total_ms"] for r in runs]
        tps = [r["metrics"]["throughput_tps"] for r in runs if r["metrics"]["throughput_tps"] > 0]

        print(f"\n  {provider}:")
        if ttfts:
            print(f"    Time to first text : avg={statistics.mean(ttfts):.0f}ms  min={min(ttfts):.0f}ms  max={max(ttfts):.0f}ms")
        print(f"    Total duration     : avg={statistics.mean(totals):.0f}ms  min={min(totals):.0f}ms  max={max(totals):.0f}ms")
        if tps:
            print(f"    Throughput         : avg={statistics.mean(tps):.0f} tps  min={min(tps):.0f}  max={max(tps):.0f}")


if __name__ == "__main__":
    main()

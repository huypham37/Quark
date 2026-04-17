#!/usr/bin/env python3
"""
profile_analyze.py — Analyze profiling results from all experiments.

Reads JSONL files from logs/proxy-profile/ and produces:
1. Per-provider breakdown (where time is spent)
2. Proxy overhead (Experiment 1 vs Experiment 2)
3. Bottleneck identification
4. Automated recommendations

Usage:
    python profile_analyze.py                    # Analyze all logs
    python profile_analyze.py --provider qwen    # Filter by provider
    python profile_analyze.py --latest            # Only most recent files
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "proxy-profile"


def load_results(provider_filter: str | None = None, latest_only: bool = False) -> dict[int, list[dict]]:
    """Load results grouped by experiment number."""
    by_experiment: dict[int, list[dict]] = defaultdict(list)

    if not LOG_DIR.exists():
        print(f"No log directory found at {LOG_DIR}")
        return by_experiment

    files = sorted(LOG_DIR.glob("*.jsonl"))
    if not files:
        print(f"No JSONL files found in {LOG_DIR}")
        return by_experiment

    if latest_only:
        # Group by prefix, keep only the latest of each
        by_prefix: dict[str, Path] = {}
        for f in files:
            # experiment-1-qwen-20260411.jsonl → experiment-1-qwen
            parts = f.stem.rsplit("-", 1)
            prefix = parts[0] if len(parts) > 1 else f.stem
            by_prefix[prefix] = f
        files = list(by_prefix.values())

    for filepath in files:
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if provider_filter and entry.get("provider") != provider_filter:
                    continue

                exp = entry.get("experiment", 0)
                by_experiment[exp].append(entry)

    return by_experiment


def analyze_experiment_1(results: list[dict]):
    """Analyze proxy-instrumented results."""
    if not results:
        return

    print("\n" + "=" * 70)
    print("  EXPERIMENT 1: Proxy-Instrumented Profiling")
    print("=" * 70)

    by_provider: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_provider[r.get("provider", "unknown")].append(r)

    for provider, runs in sorted(by_provider.items()):
        print(f"\n  ┌─ {provider} ({len(runs)} requests)")

        metrics_keys = [
            ("t_request_parse_ms", "Request parse"),
            ("t_provider_resolve_ms", "Provider resolve"),
            ("t_provider_setup_ms", "Provider setup"),
            ("t_first_event_ms", "First event (TTFE)"),
            ("t_first_text_ms", "First text (TTFT)"),
            ("t_first_reasoning_ms", "First reasoning"),
            ("t_serialization_ms", "SSE serialization"),
            ("t_write_flush_ms", "Write + flush"),
            ("t_tool_parse_ms", "Tool parsing"),
            ("t_stream_ms", "Stream duration"),
            ("t_total_ms", "Total duration"),
        ]

        for key, label in metrics_keys:
            values = [r["metrics"][key] for r in runs if r["metrics"].get(key) is not None]
            if not values:
                continue
            avg = statistics.mean(values)
            _min = min(values)
            _max = max(values)
            print(f"  │  {label:<22s}: avg={avg:>8.1f}ms  min={_min:>8.1f}ms  max={_max:>8.1f}ms")

        # Chunk gaps
        gaps = [r["metrics"]["chunk_gaps_ms"] for r in runs if "chunk_gaps_ms" in r["metrics"]]
        if gaps:
            avg_avg = statistics.mean(g["avg"] for g in gaps)
            max_p95 = max(g["p95"] for g in gaps)
            max_max = max(g["max"] for g in gaps)
            print(f"  │  {'Chunk gap avg':<22s}: {avg_avg:>8.1f}ms")
            print(f"  │  {'Chunk gap p95 (worst)':<22s}: {max_p95:>8.1f}ms")
            print(f"  │  {'Chunk gap max (worst)':<22s}: {max_max:>8.1f}ms")

        # Throughput
        tps = [r["metrics"]["throughput_tps"] for r in runs if r["metrics"].get("throughput_tps", 0) > 0]
        if tps:
            print(f"  │  {'Throughput':<22s}: avg={statistics.mean(tps):>8.1f} tps")

        # Time breakdown (% of total)
        totals = [r["metrics"]["t_total_ms"] for r in runs]
        avg_total = statistics.mean(totals)
        if avg_total > 0:
            print(f"  │")
            print(f"  │  Time breakdown (% of {avg_total:.0f}ms total):")
            breakdown_keys = [
                ("t_provider_setup_ms", "Setup"),
                ("t_serialization_ms", "Serialization"),
                ("t_write_flush_ms", "Write+flush"),
                ("t_tool_parse_ms", "Tool parsing"),
            ]
            for key, label in breakdown_keys:
                values = [r["metrics"].get(key, 0) for r in runs]
                avg_val = statistics.mean(values)
                pct = (avg_val / avg_total) * 100
                bar = "█" * int(pct / 2)
                if avg_val > 0.1:
                    print(f"  │    {label:<16s}: {avg_val:>6.1f}ms ({pct:>5.1f}%) {bar}")

        print(f"  └──────────────────────────────────────")


def analyze_experiment_2(results: list[dict]):
    """Analyze direct baseline results."""
    if not results:
        return

    print("\n" + "=" * 70)
    print("  EXPERIMENT 2: Direct Provider Baseline (No Proxy)")
    print("=" * 70)

    by_provider: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_provider[r.get("provider", "unknown")].append(r)

    for provider, runs in sorted(by_provider.items()):
        print(f"\n  ┌─ {provider} ({len(runs)} runs)")

        for key, label in [
            ("t_first_event_ms", "First event"),
            ("t_first_text_ms", "First text"),
            ("t_first_reasoning_ms", "First reasoning"),
            ("t_total_ms", "Total duration"),
        ]:
            values = [r["metrics"][key] for r in runs if r["metrics"].get(key) is not None]
            if not values:
                continue
            print(f"  │  {label:<22s}: avg={statistics.mean(values):>8.1f}ms  min={min(values):>8.1f}ms  max={max(values):>8.1f}ms")

        tps = [r["metrics"]["throughput_tps"] for r in runs if r["metrics"].get("throughput_tps", 0) > 0]
        if tps:
            print(f"  │  {'Throughput':<22s}: avg={statistics.mean(tps):>8.1f} tps")

        print(f"  └──────────────────────────────────────")


def analyze_experiment_3(results: list[dict]):
    """Analyze curl HTTP-level results."""
    if not results:
        return

    print("\n" + "=" * 70)
    print("  EXPERIMENT 3: curl HTTP-Level Timing")
    print("=" * 70)

    for key, label in [
        ("t_connect_ms", "TCP connect"),
        ("t_ttfb_ms", "TTFB"),
        ("t_total_ms", "Total"),
    ]:
        values = [r["metrics"][key] for r in results if key in r.get("metrics", {})]
        if not values:
            continue
        print(f"  {label:<22s}: avg={statistics.mean(values):>8.1f}ms  min={min(values):>8.1f}ms  max={max(values):>8.1f}ms")


def compare_experiments(by_experiment: dict[int, list[dict]]):
    """Compare Experiment 1 vs 2 to isolate proxy overhead."""
    exp1 = by_experiment.get(1, [])
    exp2 = by_experiment.get(2, [])

    if not exp1 or not exp2:
        return

    print("\n" + "=" * 70)
    print("  PROXY OVERHEAD COMPARISON (Exp 1 vs Exp 2)")
    print("=" * 70)

    # Group both by provider
    exp1_by_provider: dict[str, list[dict]] = defaultdict(list)
    exp2_by_provider: dict[str, list[dict]] = defaultdict(list)
    for r in exp1:
        exp1_by_provider[r.get("provider", "unknown")].append(r)
    for r in exp2:
        exp2_by_provider[r.get("provider", "unknown")].append(r)

    common = set(exp1_by_provider.keys()) & set(exp2_by_provider.keys())
    for provider in sorted(common):
        runs1 = exp1_by_provider[provider]
        runs2 = exp2_by_provider[provider]

        avg_total_1 = statistics.mean(r["metrics"]["t_total_ms"] for r in runs1)
        avg_total_2 = statistics.mean(r["metrics"]["t_total_ms"] for r in runs2)
        overhead = avg_total_1 - avg_total_2
        pct = (overhead / avg_total_2 * 100) if avg_total_2 > 0 else 0

        ttft_1 = [r["metrics"]["t_first_text_ms"] for r in runs1 if r["metrics"].get("t_first_text_ms")]
        ttft_2 = [r["metrics"]["t_first_text_ms"] for r in runs2 if r["metrics"].get("t_first_text_ms")]
        ttft_overhead = (statistics.mean(ttft_1) - statistics.mean(ttft_2)) if ttft_1 and ttft_2 else None

        print(f"\n  {provider}:")
        print(f"    Total (proxy) : {avg_total_1:>8.1f} ms")
        print(f"    Total (direct): {avg_total_2:>8.1f} ms")
        print(f"    Overhead      : {overhead:>+8.1f} ms ({pct:>+.1f}%)")
        if ttft_overhead is not None:
            print(f"    TTFT overhead : {ttft_overhead:>+8.1f} ms")


def generate_recommendations(by_experiment: dict[int, list[dict]]):
    """Generate automated recommendations based on findings."""
    print("\n" + "=" * 70)
    print("  RECOMMENDATIONS")
    print("=" * 70)

    recommendations = []

    exp1 = by_experiment.get(1, [])
    for r in exp1:
        m = r["metrics"]
        provider = r.get("provider", "unknown")

        setup = m.get("t_provider_setup_ms", 0)
        if setup > 500:
            recommendations.append(
                f"⚠️  {provider}: Provider setup takes {setup:.0f}ms. "
                f"Consider pooling/reusing chat sessions instead of create+delete per request."
            )

        gaps = m.get("chunk_gaps_ms", {})
        if gaps.get("p95", 0) > 200:
            recommendations.append(
                f"⚠️  {provider}: Chunk gap p95 is {gaps['p95']:.0f}ms. "
                f"Likely buffering in iter_lines() or wfile. "
                f"Try iter_content(chunk_size=1) or enable TCP_NODELAY."
            )
        if gaps.get("max", 0) > 1000:
            recommendations.append(
                f"🔴 {provider}: Max chunk gap is {gaps['max']:.0f}ms. "
                f"This suggests upstream stalls or large internal buffering."
            )

        total = m.get("t_total_ms", 1)
        ser_pct = m.get("t_serialization_ms", 0) / total * 100 if total > 0 else 0
        if ser_pct > 5:
            recommendations.append(
                f"⚠️  {provider}: SSE serialization is {ser_pct:.1f}% of total time. "
                f"Consider pre-building template strings instead of json.dumps per chunk."
            )

        write_pct = m.get("t_write_flush_ms", 0) / total * 100 if total > 0 else 0
        if write_pct > 10:
            recommendations.append(
                f"🔴 {provider}: Write+flush is {write_pct:.1f}% of total time. "
                f"Enable TCP_NODELAY on the socket, or switch to an async server (aiohttp/uvicorn)."
            )

    # Deduplicate
    seen = set()
    for rec in recommendations:
        if rec not in seen:
            seen.add(rec)
            print(f"\n  {rec}")

    if not recommendations:
        print("\n  ✅ No obvious bottlenecks detected. The proxy overhead appears minimal.")

    print()


def main():
    parser = argparse.ArgumentParser(description="Analyze web-proxy profiling results")
    parser.add_argument("--provider", help="Filter by provider name")
    parser.add_argument("--latest", action="store_true", help="Only analyze most recent files")
    args = parser.parse_args()

    by_experiment = load_results(args.provider, args.latest)

    total = sum(len(v) for v in by_experiment.values())
    if total == 0:
        print("No profiling data found. Run the experiments first:")
        print("  1. WEB_PROXY_PROFILE=1 python run.py     (then send requests)")
        print("  2. python profile_baseline.py")
        print("  3. bash profile_curl.sh")
        return

    print(f"\nLoaded {total} entries across experiments: {sorted(by_experiment.keys())}")

    analyze_experiment_1(by_experiment.get(1, []))
    analyze_experiment_2(by_experiment.get(2, []))
    analyze_experiment_3(by_experiment.get(3, []))
    compare_experiments(by_experiment)
    generate_recommendations(by_experiment)

    # Write summary
    summary_path = LOG_DIR / "summary-latest.json"
    summary = {
        "total_entries": total,
        "experiments": {str(k): len(v) for k, v in by_experiment.items()},
    }
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary written to {summary_path}")


if __name__ == "__main__":
    main()

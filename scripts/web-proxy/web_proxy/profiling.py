"""
profiling.py — Timing instrumentation for web-proxy latency analysis.

Enabled via WEB_PROXY_PROFILE=1 environment variable.
Writes JSON Lines to logs/proxy-profile/.

Usage in server.py:
    from web_proxy.profiling import is_profiling, ProfilingContext, profiled_stream

    if is_profiling():
        ctx = ProfilingContext(provider="qwen", model="qwen3-max")
        for event in profiled_stream(ctx, provider.stream(messages, model, tools)):
            ...
        ctx.finish()
"""

from __future__ import annotations

import json
import os
import time
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Any

from web_proxy.base import SSEEvent, TextDelta, ReasoningDelta, ToolCall, Done


# ---------------------------------------------------------------------------
# Enable / disable
# ---------------------------------------------------------------------------

def is_profiling() -> bool:
    return os.environ.get("WEB_PROXY_PROFILE", "").strip() in ("1", "true", "yes")


# ---------------------------------------------------------------------------
# Log directory
# ---------------------------------------------------------------------------

_LOG_DIR = Path(__file__).resolve().parent.parent.parent.parent / "logs" / "proxy-profile"


def _ensure_log_dir() -> Path:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    return _LOG_DIR


# ---------------------------------------------------------------------------
# High-resolution timer
# ---------------------------------------------------------------------------

def _now_ms() -> float:
    """Monotonic clock in milliseconds."""
    return time.monotonic() * 1000


def _wall_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


# ---------------------------------------------------------------------------
# ProfilingContext — accumulates per-request timing data
# ---------------------------------------------------------------------------

@dataclass
class ProfilingContext:
    provider: str
    model: str
    experiment: int = 1
    prompt_preview: str = ""

    # Timestamps (monotonic ms)
    t_request_start: float = field(default_factory=_now_ms)
    t_provider_resolve: float = 0.0
    t_stream_start: float = 0.0
    t_first_event: float = 0.0
    t_first_text: float = 0.0
    t_first_reasoning: float = 0.0
    t_stream_end: float = 0.0

    # Phase timings (cumulative ms)
    t_request_parse_ms: float = 0.0
    t_provider_resolve_ms: float = 0.0
    t_provider_setup_ms: float = 0.0
    t_serialization_ms: float = 0.0
    t_write_flush_ms: float = 0.0
    t_tool_parse_ms: float = 0.0

    # Chunk gap tracking
    _chunk_timestamps: list[float] = field(default_factory=list)
    _chunk_gaps: list[float] = field(default_factory=list)

    # Counters
    event_count: int = 0
    text_event_count: int = 0
    reasoning_event_count: int = 0
    tool_call_count: int = 0
    bytes_total: int = 0

    # Flags
    _saw_first_event: bool = False
    _saw_first_text: bool = False
    _saw_first_reasoning: bool = False

    def mark_resolve_start(self):
        self.t_provider_resolve = _now_ms()

    def mark_resolve_end(self):
        self.t_provider_resolve_ms = _now_ms() - self.t_provider_resolve

    def mark_stream_start(self):
        self.t_stream_start = _now_ms()

    def mark_event(self, event: SSEEvent):
        now = _now_ms()
        self.event_count += 1

        # Chunk gap
        if self._chunk_timestamps:
            gap = now - self._chunk_timestamps[-1]
            self._chunk_gaps.append(gap)
        self._chunk_timestamps.append(now)

        # First event
        if not self._saw_first_event:
            self._saw_first_event = True
            self.t_first_event = now

        # Type-specific
        if isinstance(event, TextDelta):
            self.text_event_count += 1
            if not self._saw_first_text:
                self._saw_first_text = True
                self.t_first_text = now
        elif isinstance(event, ReasoningDelta):
            self.reasoning_event_count += 1
            if not self._saw_first_reasoning:
                self._saw_first_reasoning = True
                self.t_first_reasoning = now
        elif isinstance(event, ToolCall):
            self.tool_call_count += 1

    def mark_serialize_start(self) -> float:
        return _now_ms()

    def mark_serialize_end(self, start: float):
        self.t_serialization_ms += _now_ms() - start

    def mark_write_start(self) -> float:
        return _now_ms()

    def mark_write_end(self, start: float):
        self.t_write_flush_ms += _now_ms() - start

    def add_bytes(self, n: int):
        self.bytes_total += n

    def finish(self):
        self.t_stream_end = _now_ms()
        self._write_log()

    def _gap_stats(self) -> dict:
        if not self._chunk_gaps:
            return {"min": 0, "max": 0, "avg": 0, "p95": 0, "p99": 0, "count": 0}
        gaps = sorted(self._chunk_gaps)
        n = len(gaps)
        return {
            "min": round(gaps[0], 2),
            "max": round(gaps[-1], 2),
            "avg": round(statistics.mean(gaps), 2),
            "median": round(statistics.median(gaps), 2),
            "p95": round(gaps[int(n * 0.95)] if n > 1 else gaps[0], 2),
            "p99": round(gaps[int(n * 0.99)] if n > 1 else gaps[0], 2),
            "count": n,
        }

    def to_dict(self) -> dict:
        t0 = self.t_request_start
        t_stream = self.t_stream_start or t0
        t_end = self.t_stream_end or _now_ms()

        # Approximate tokens
        tokens_approx = max(self.text_event_count, 1)
        duration_s = (t_end - t_stream) / 1000
        throughput = tokens_approx / duration_s if duration_s > 0 else 0

        return {
            "experiment": self.experiment,
            "provider": self.provider,
            "model": self.model,
            "prompt_preview": self.prompt_preview[:80],
            "timestamp": _wall_iso(),
            "metrics": {
                "t_request_parse_ms": round(self.t_request_parse_ms, 2),
                "t_provider_resolve_ms": round(self.t_provider_resolve_ms, 2),
                "t_provider_setup_ms": round(self.t_provider_setup_ms, 2),
                "t_first_event_ms": round((self.t_first_event - t_stream), 2) if self.t_first_event else None,
                "t_first_text_ms": round((self.t_first_text - t_stream), 2) if self.t_first_text else None,
                "t_first_reasoning_ms": round((self.t_first_reasoning - t_stream), 2) if self.t_first_reasoning else None,
                "t_total_ms": round(t_end - t0, 2),
                "t_stream_ms": round(t_end - t_stream, 2),
                "t_serialization_ms": round(self.t_serialization_ms, 2),
                "t_write_flush_ms": round(self.t_write_flush_ms, 2),
                "t_tool_parse_ms": round(self.t_tool_parse_ms, 2),
                "chunk_gaps_ms": self._gap_stats(),
                "event_count": self.event_count,
                "text_event_count": self.text_event_count,
                "reasoning_event_count": self.reasoning_event_count,
                "tool_call_count": self.tool_call_count,
                "bytes_total": self.bytes_total,
                "tokens_approx": tokens_approx,
                "throughput_tps": round(throughput, 1),
            },
        }

    def _write_log(self):
        try:
            log_dir = _ensure_log_dir()
            ts = time.strftime("%Y%m%d", time.gmtime())
            filename = f"experiment-{self.experiment}-{self.provider}-{ts}.jsonl"
            filepath = log_dir / filename
            with open(filepath, "a") as f:
                f.write(json.dumps(self.to_dict()) + "\n")
            self._print_summary()
        except Exception as e:
            print(f"[profile] Failed to write log: {e}")

    def _print_summary(self):
        d = self.to_dict()
        m = d["metrics"]
        print(f"\n[profile] ═══════════════════════════════════════════════")
        print(f"[profile] Provider: {d['provider']} | Model: {d['model']}")
        print(f"[profile] ───────────────────────────────────────────────")
        print(f"[profile]   Request parse     : {m['t_request_parse_ms']:>8.1f} ms")
        print(f"[profile]   Provider resolve  : {m['t_provider_resolve_ms']:>8.1f} ms")
        print(f"[profile]   Provider setup    : {m['t_provider_setup_ms']:>8.1f} ms")
        print(f"[profile]   First event       : {m['t_first_event_ms'] or 0:>8.1f} ms")
        print(f"[profile]   First text        : {m['t_first_text_ms'] or 0:>8.1f} ms")
        print(f"[profile]   First reasoning   : {m['t_first_reasoning_ms'] or 0:>8.1f} ms")
        print(f"[profile]   Stream duration   : {m['t_stream_ms']:>8.1f} ms")
        print(f"[profile]   Total duration    : {m['t_total_ms']:>8.1f} ms")
        print(f"[profile]   Serialization     : {m['t_serialization_ms']:>8.1f} ms ({m['t_serialization_ms'] / max(m['t_stream_ms'], 1) * 100:.1f}%)")
        print(f"[profile]   Write+flush       : {m['t_write_flush_ms']:>8.1f} ms ({m['t_write_flush_ms'] / max(m['t_stream_ms'], 1) * 100:.1f}%)")
        print(f"[profile]   Tool parsing      : {m['t_tool_parse_ms']:>8.1f} ms")
        gaps = m["chunk_gaps_ms"]
        print(f"[profile]   Chunk gaps        : avg={gaps['avg']:.0f}ms  p95={gaps['p95']:.0f}ms  max={gaps['max']:.0f}ms  ({gaps['count']} gaps)")
        print(f"[profile]   Events            : {m['event_count']} total ({m['text_event_count']} text, {m['reasoning_event_count']} reasoning, {m['tool_call_count']} tools)")
        print(f"[profile]   Bytes             : {m['bytes_total']}")
        print(f"[profile]   Throughput        : {m['throughput_tps']:.0f} tokens/sec")
        print(f"[profile] ═══════════════════════════════════════════════\n")


# ---------------------------------------------------------------------------
# profiled_stream — generator wrapper that instruments each event
# ---------------------------------------------------------------------------

def profiled_stream(
    ctx: ProfilingContext,
    stream: Iterator[SSEEvent],
) -> Iterator[SSEEvent]:
    """Wrap a provider stream to collect timing on every yielded event."""
    ctx.mark_stream_start()
    for event in stream:
        ctx.mark_event(event)
        yield event

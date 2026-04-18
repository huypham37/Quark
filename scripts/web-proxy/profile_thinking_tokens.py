#!/usr/bin/env python3
"""
profile_thinking_tokens.py — Experiment: Thinking token format analysis.

Captures RAW SSE events from each provider/model to document:
- What fields are present in each SSE event (phase, status, reasoning_content, etc.)
- The exact structure of thinking/reasoning events
- Transition patterns between thinking and answer phases
- Native function_call event structure (if any)

Targets:
    qwen3.6-plus      — Phase-based thinking (phase="think")
    qwen3-coder-plus  — Phase-based thinking (same?)
    meta-ai           — ThinkingStatus sections in GraphQL response

Usage:
    python profile_thinking_tokens.py                        # All targets
    python profile_thinking_tokens.py --target qwen3.6-plus  # Specific model
    python profile_thinking_tokens.py --target meta-ai
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from pathlib import Path
from typing import Iterator

# ---------------------------------------------------------------------------
# Log directory
# ---------------------------------------------------------------------------

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs" / "proxy-profile"


def ensure_log_dir() -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR


# ---------------------------------------------------------------------------
# Prompt — must trigger reasoning/thinking
# ---------------------------------------------------------------------------

THINKING_PROMPT = "Think step by step: what is 127 * 43? Show your reasoning."


# ---------------------------------------------------------------------------
# Qwen raw event capture
# ---------------------------------------------------------------------------

def capture_qwen_raw(model_id: str) -> dict:
    """Capture raw SSE events from Qwen to document thinking token format."""
    from web_proxy.providers.qwen import QwenProvider

    provider = QwenProvider()
    if not provider.authenticate():
        return {"error": "Qwen authentication failed", "model": model_id}

    print(f"\n[thinking-tokens] Qwen/{model_id}: Creating chat...")
    chat_id = provider._create_chat(model_id)
    print(f"[thinking-tokens] Qwen/{model_id}: Chat created: {chat_id}")

    raw_events: list[dict] = []
    t_start = time.monotonic()
    t_first_event = None
    t_first_thinking = None
    t_first_answer = None
    phase_transitions: list[dict] = []
    last_phase = None
    event_index = 0

    try:
        for obj in provider._raw_stream_http(chat_id, model_id, THINKING_PROMPT, has_tools=False):
            now = time.monotonic()
            elapsed_ms = (now - t_start) * 1000

            if t_first_event is None:
                t_first_event = now

            choices = obj.get("choices", [])
            delta = choices[0].get("delta", {}) if choices else {}
            phase = delta.get("phase")
            status = delta.get("status")

            # Track phase transitions
            if phase != last_phase:
                phase_transitions.append({
                    "event_index": event_index,
                    "from_phase": last_phase,
                    "to_phase": phase,
                    "status": status,
                    "elapsed_ms": round(elapsed_ms, 2),
                })
                if phase == "think" and t_first_thinking is None:
                    t_first_thinking = now
                if phase == "answer" and t_first_answer is None:
                    t_first_answer = now
                last_phase = phase

            # Capture the raw event (first 50 + last 10 to keep log manageable)
            if event_index < 50 or (status == "finished") or (phase != "think"):
                raw_events.append({
                    "index": event_index,
                    "elapsed_ms": round(elapsed_ms, 2),
                    "raw": _truncate_event(obj),
                })
            elif event_index == 50:
                raw_events.append({
                    "index": event_index,
                    "elapsed_ms": round(elapsed_ms, 2),
                    "note": f"... truncating think-phase events (capturing transitions and non-think events) ...",
                })

            event_index += 1

    except Exception as e:
        raw_events.append({"error": str(e)})
    finally:
        provider._delete_chat(chat_id)

    t_end = time.monotonic()

    return {
        "provider": "qwen",
        "model": model_id,
        "prompt": THINKING_PROMPT,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "timing": {
            "total_ms": round((t_end - t_start) * 1000, 2),
            "t_first_event_ms": round((t_first_event - t_start) * 1000, 2) if t_first_event else None,
            "t_first_thinking_ms": round((t_first_thinking - t_start) * 1000, 2) if t_first_thinking else None,
            "t_first_answer_ms": round((t_first_answer - t_start) * 1000, 2) if t_first_answer else None,
        },
        "total_events": event_index,
        "phase_transitions": phase_transitions,
        "raw_events_sample": raw_events,
    }


def _truncate_event(obj: dict) -> dict:
    """Truncate large content fields for logging."""
    result = {}
    for k, v in obj.items():
        if k == "choices" and isinstance(v, list):
            result[k] = []
            for choice in v:
                c = dict(choice)
                delta = c.get("delta", {})
                if isinstance(delta, dict):
                    d = dict(delta)
                    # Truncate content and reasoning_content to 200 chars
                    for field in ("content", "reasoning_content"):
                        if field in d and isinstance(d[field], str) and len(d[field]) > 200:
                            d[field] = d[field][:200] + f"... ({len(d[field])} chars total)"
                    c["delta"] = d
                result[k].append(c)
        else:
            result[k] = v
    return result


# ---------------------------------------------------------------------------
# Meta raw event capture
# ---------------------------------------------------------------------------

def capture_meta_raw() -> dict:
    """Capture raw response from Meta to document thinking token format."""
    import os
    import requests as http_requests

    rd = os.environ.get("META_RD_CHALLENGE", "")
    ecto = os.environ.get("META_ECTO_SESS", "")
    if not rd or not ecto:
        return {"error": "Meta authentication failed — set META_RD_CHALLENGE and META_ECTO_SESS", "model": "meta-ai"}

    from web_proxy.providers.meta import MetaProvider, META_GRAPHQL, UA, WARMUP_DOC_ID, SEND_DOC_ID, _unique_message_id

    cookies = {"rd_challenge": rd, "ecto_1_sess": ecto}
    base_headers = {"User-Agent": UA, "Origin": "https://meta.ai", "Content-Type": "application/json"}
    conv_id = str(uuid.uuid4())

    print(f"\n[thinking-tokens] Meta/meta-ai: Warming up conversation...")
    try:
        http_requests.post(
            META_GRAPHQL,
            cookies=cookies,
            headers=base_headers,
            json={"doc_id": WARMUP_DOC_ID, "variables": {"conversationId": conv_id}},
            timeout=10,
        )
    except Exception:
        pass

    print(f"[thinking-tokens] Meta/meta-ai: Sending message...")
    t_start = time.monotonic()

    r = http_requests.post(
        META_GRAPHQL,
        cookies=cookies,
        headers=base_headers,
        json={
            "doc_id": SEND_DOC_ID,
            "variables": {
                "conversationId": conv_id,
                "content": THINKING_PROMPT,
                "userMessageId": str(uuid.uuid4()),
                "assistantMessageId": str(uuid.uuid4()),
                "userUniqueMessageId": _unique_message_id(),
                "turnId": str(uuid.uuid4()),
            },
        },
        timeout=120,
    )
    t_end = time.monotonic()

    if r.status_code != 200:
        return {"error": f"Meta returned {r.status_code}: {r.text[:400]}", "model": "meta-ai"}

    # Parse raw SSE lines
    raw_events: list[dict] = []
    thinking_events: list[dict] = []
    text_events: list[dict] = []
    event_index = 0

    for line in r.text.split("\n"):
        line = line.strip()
        if not line.startswith("data: "):
            continue
        try:
            obj = json.loads(line[6:])
        except json.JSONDecodeError:
            continue

        msg = obj.get("data", {}).get("sendMessageStream", {})
        typename = msg.get("__typename", "")
        streaming_state = msg.get("streamingState", "")

        cr = msg.get("contentRenderer", {})
        ur = cr.get("unified_response") or {}
        sections = ur.get("sections", [])

        # Capture section details
        section_details = []
        for section in sections:
            prim = section.get("view_model", {}).get("primitive", {})
            tn = prim.get("__typename", "")
            section_info = {
                "__typename": tn,
            }

            if "ThinkingStatus" in tn:
                section_info["is_in_progress"] = prim.get("is_in_progress")
                section_info["thought_text"] = (prim.get("thought_text") or "")[:200]
                section_info["title"] = prim.get("title", "")
                # Capture all keys for documentation
                section_info["all_keys"] = list(prim.keys())
                thinking_events.append(section_info)

            elif "MarkdownText" in tn:
                text_content = prim.get("text", "")
                section_info["text_length"] = len(text_content)
                section_info["text_preview"] = text_content[:200]
                section_info["all_keys"] = list(prim.keys())
                text_events.append(section_info)
            else:
                section_info["all_keys"] = list(prim.keys())

            section_details.append(section_info)

        # Log the first 30 and transitions
        if event_index < 30 or streaming_state == "DONE" or thinking_events:
            raw_events.append({
                "index": event_index,
                "typename": typename,
                "streaming_state": streaming_state,
                "sections": section_details,
            })

        event_index += 1

    return {
        "provider": "meta",
        "model": "meta-ai",
        "prompt": THINKING_PROMPT,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "timing": {
            "total_ms": round((t_end - t_start) * 1000, 2),
        },
        "total_events": event_index,
        "thinking_events_count": len(thinking_events),
        "text_events_count": len(text_events),
        "thinking_events_sample": thinking_events[:20],
        "text_events_sample": text_events[:5],
        "raw_events_sample": raw_events,
    }


# ---------------------------------------------------------------------------
# Print results
# ---------------------------------------------------------------------------

def print_qwen_result(result: dict):
    if "error" in result:
        print(f"  ❌ {result['error']}")
        return

    print(f"\n{'='*70}")
    print(f"  QWEN THINKING TOKEN FORMAT: {result['model']}")
    print(f"{'='*70}")
    print(f"  Total events : {result['total_events']}")
    timing = result["timing"]
    print(f"  First event  : {timing['t_first_event_ms']}ms")
    print(f"  First think  : {timing['t_first_thinking_ms']}ms")
    print(f"  First answer : {timing['t_first_answer_ms']}ms")
    print(f"  Total        : {timing['total_ms']:.0f}ms")

    print(f"\n  Phase transitions ({len(result['phase_transitions'])}):")
    for pt in result["phase_transitions"]:
        print(f"    [{pt['event_index']:>4}] {pt['from_phase']} → {pt['to_phase']} (status={pt['status']}) at {pt['elapsed_ms']:.0f}ms")

    print(f"\n  Raw event samples (first few):")
    for ev in result["raw_events_sample"][:10]:
        if "note" in ev:
            print(f"    [{ev['index']:>4}] {ev['note']}")
            continue
        raw = ev.get("raw", {})
        choices = raw.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            phase = delta.get("phase", "-")
            status = delta.get("status", "-")
            content = delta.get("content", "")[:60]
            reasoning = delta.get("reasoning_content", "")[:60]
            fc = delta.get("function_call")
            role = delta.get("role", "")
            finish = choices[0].get("finish_reason", "")

            fields = f"phase={phase} status={status}"
            if role:
                fields += f" role={role}"
            if content:
                fields += f" content={repr(content)}"
            if reasoning:
                fields += f" reasoning={repr(reasoning)}"
            if fc:
                fields += f" function_call={fc}"
            if finish:
                fields += f" finish={finish}"

            # List all delta keys for documentation
            delta_keys = list(delta.keys())
            fields += f" delta_keys={delta_keys}"

            print(f"    [{ev['index']:>4}] {ev['elapsed_ms']:>8.0f}ms | {fields}")


def print_meta_result(result: dict):
    if "error" in result:
        print(f"  ❌ {result['error']}")
        return

    print(f"\n{'='*70}")
    print(f"  META THINKING TOKEN FORMAT: {result['model']}")
    print(f"{'='*70}")
    print(f"  Total events            : {result['total_events']}")
    print(f"  Thinking events         : {result['thinking_events_count']}")
    print(f"  Text events             : {result['text_events_count']}")
    print(f"  Total                   : {result['timing']['total_ms']:.0f}ms")

    if result["thinking_events_sample"]:
        print(f"\n  ThinkingStatus events ({len(result['thinking_events_sample'])} sample):")
        for i, te in enumerate(result["thinking_events_sample"]):
            print(f"    [{i}] __typename={te['__typename']}")
            print(f"        is_in_progress={te.get('is_in_progress')}")
            print(f"        title={repr(te.get('title', ''))}")
            print(f"        thought_text={repr(te.get('thought_text', '')[:100])}")
            print(f"        all_keys={te.get('all_keys', [])}")

    if result["text_events_sample"]:
        print(f"\n  MarkdownText events ({len(result['text_events_sample'])} sample):")
        for i, te in enumerate(result["text_events_sample"]):
            print(f"    [{i}] __typename={te['__typename']}")
            print(f"        text_length={te.get('text_length')}")
            print(f"        text_preview={repr(te.get('text_preview', '')[:100])}")
            print(f"        all_keys={te.get('all_keys', [])}")

    print(f"\n  Raw event structure (first few):")
    for ev in result["raw_events_sample"][:10]:
        print(f"    [{ev['index']:>4}] typename={ev['typename']} state={ev['streaming_state']}")
        for s in ev.get("sections", []):
            print(f"          section: {s['__typename']} keys={s.get('all_keys', [])}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Capture thinking token formats from providers")
    parser.add_argument("--target", choices=["qwen3.6-plus", "qwen3-coder-plus", "qwen3-max", "meta-ai", "all"], default="all")
    args = parser.parse_args()

    log_dir = ensure_log_dir()
    ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    all_results = []

    targets = []
    if args.target == "all":
        targets = ["qwen3-max", "qwen3.6-plus", "qwen3-coder-plus", "meta-ai"]
    else:
        targets = [args.target]

    for target in targets:
        print(f"\n{'='*70}")
        print(f"[thinking-tokens] Target: {target}")
        print(f"{'='*70}")

        if target in ("qwen3.6-plus", "qwen3-coder-plus", "qwen3-max"):
            result = capture_qwen_raw(target)
            print_qwen_result(result)
        elif target == "meta-ai":
            result = capture_meta_raw()
            print_meta_result(result)
        else:
            continue

        all_results.append(result)
        time.sleep(2)

    # Write results
    outfile = log_dir / f"thinking-tokens-{ts}.json"
    with open(outfile, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\n[thinking-tokens] Full results written to {outfile}")


if __name__ == "__main__":
    main()

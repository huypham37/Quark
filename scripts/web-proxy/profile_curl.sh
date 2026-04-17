#!/usr/bin/env bash
# profile_curl.sh — Experiment 3: HTTP-level timing via curl
#
# Measures TCP connect, TLS handshake, TTFB, and total time
# from the client's perspective (curl → proxy → upstream).
#
# Usage:
#   ./profile_curl.sh                           # All defaults
#   ./profile_curl.sh --model web/qwen3-max     # Specific model
#   ./profile_curl.sh --prompt medium            # Specific prompt
#   ./profile_curl.sh --runs 5                   # More runs
#
# Requires: curl, jq
# The web-proxy must be running on localhost:4320

set -euo pipefail

PROXY_URL="${WEB_PROXY_URL:-http://127.0.0.1:4320}"
RUNS="${RUNS:-3}"
MODEL="${MODEL:-web/qwen3-max}"
PROMPT_TYPE="${PROMPT_TYPE:-short}"
LOG_DIR="$(cd "$(dirname "$0")/../.." && pwd)/logs/proxy-profile"

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        --model) MODEL="$2"; shift 2 ;;
        --prompt) PROMPT_TYPE="$2"; shift 2 ;;
        --runs) RUNS="$2"; shift 2 ;;
        --url) PROXY_URL="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
declare -A PROMPTS
PROMPTS[short]='{"model":"'"$MODEL"'","stream":true,"messages":[{"role":"user","content":"What is 2+2? Answer in one word."}]}'
PROMPTS[medium]='{"model":"'"$MODEL"'","stream":true,"messages":[{"role":"user","content":"Explain the difference between TCP and UDP in 3 paragraphs."}]}'
PROMPTS[long]='{"model":"'"$MODEL"'","stream":true,"messages":[{"role":"user","content":"Write a Python implementation of a basic HTTP server with routing, explain each part."}]}'
PROMPTS[reasoning]='{"model":"'"$MODEL"'","stream":true,"messages":[{"role":"user","content":"Think step by step: what is 127 * 43?"}]}'

BODY="${PROMPTS[$PROMPT_TYPE]:-${PROMPTS[short]}}"

# curl write-out format
CURL_FORMAT='{
  "time_namelookup": %{time_namelookup},
  "time_connect": %{time_connect},
  "time_appconnect": %{time_appconnect},
  "time_pretransfer": %{time_pretransfer},
  "time_starttransfer": %{time_starttransfer},
  "time_total": %{time_total},
  "size_download": %{size_download},
  "speed_download": %{speed_download},
  "http_code": %{http_code}
}'

TS=$(date -u +%Y%m%d-%H%M%S)
OUTFILE="$LOG_DIR/experiment-3-curl-$TS.jsonl"

echo "═══════════════════════════════════════════════════════"
echo "  Experiment 3: curl HTTP-level profiling"
echo "  Proxy    : $PROXY_URL"
echo "  Model    : $MODEL"
echo "  Prompt   : $PROMPT_TYPE"
echo "  Runs     : $RUNS"
echo "  Output   : $OUTFILE"
echo "═══════════════════════════════════════════════════════"

# ---------------------------------------------------------------------------
# Check proxy is running
# ---------------------------------------------------------------------------
if ! curl -sf "$PROXY_URL/health" > /dev/null 2>&1; then
    echo ""
    echo "❌ Proxy not reachable at $PROXY_URL/health"
    echo "   Start it with: WEB_PROXY_PROFILE=1 python run.py"
    exit 1
fi

echo ""
echo "✅ Proxy is healthy"

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
for run in $(seq 1 "$RUNS"); do
    echo ""
    echo "── Run $run/$RUNS ──────────────────────────────"

    # Stream the response, capture timing + first/last SSE event timestamps
    START_EPOCH=$(python3 -c "import time; print(time.time())")

    TIMING=$(curl -s \
        -X POST "$PROXY_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "$BODY" \
        -w "$CURL_FORMAT" \
        -o /dev/null \
        2>/dev/null)

    # Parse timing
    T_CONNECT=$(echo "$TIMING" | python3 -c "import sys,json; print(json.load(sys.stdin)['time_connect'])")
    T_TTFB=$(echo "$TIMING" | python3 -c "import sys,json; print(json.load(sys.stdin)['time_starttransfer'])")
    T_TOTAL=$(echo "$TIMING" | python3 -c "import sys,json; print(json.load(sys.stdin)['time_total'])")
    SIZE=$(echo "$TIMING" | python3 -c "import sys,json; print(json.load(sys.stdin)['size_download'])")
    HTTP_CODE=$(echo "$TIMING" | python3 -c "import sys,json; print(json.load(sys.stdin)['http_code'])")

    T_CONNECT_MS=$(python3 -c "print(round($T_CONNECT * 1000, 2))")
    T_TTFB_MS=$(python3 -c "print(round($T_TTFB * 1000, 2))")
    T_TOTAL_MS=$(python3 -c "print(round($T_TOTAL * 1000, 2))")

    echo "  HTTP status     : $HTTP_CODE"
    echo "  TCP connect     : ${T_CONNECT_MS} ms"
    echo "  TTFB            : ${T_TTFB_MS} ms"
    echo "  Total           : ${T_TOTAL_MS} ms"
    echo "  Downloaded      : $SIZE bytes"

    # Write JSONL
    python3 -c "
import json, sys
entry = {
    'experiment': 3,
    'model': '$MODEL',
    'prompt_type': '$PROMPT_TYPE',
    'run': $run,
    'metrics': {
        't_connect_ms': $T_CONNECT_MS,
        't_ttfb_ms': $T_TTFB_MS,
        't_total_ms': $T_TOTAL_MS,
        'size_bytes': $SIZE,
        'http_code': $HTTP_CODE,
    }
}
print(json.dumps(entry))
" >> "$OUTFILE"

    # Delay between runs
    if [ "$run" -lt "$RUNS" ]; then
        sleep 2
    fi
done

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Results written to: $OUTFILE"
echo "═══════════════════════════════════════════════════════"

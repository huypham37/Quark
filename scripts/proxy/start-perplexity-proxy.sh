#!/usr/bin/env bash
# start-perplexity-proxy.sh — start perplexity-proxy in a persistent tmux session

SESSION="perplexity-proxy-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/perplexity-proxy.py"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start-perplexity-proxy] Session '$SESSION' already running."
  echo "  Attach: tmux attach -t $SESSION"
  echo "  Kill:   tmux kill-session -t $SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" -x 220 -y 50
PYTHON=$(which python3 2>/dev/null)
# Prefer conda python which has curl_cffi
if [ -f "/opt/homebrew/Caskroom/miniconda/base/bin/python3" ]; then
  PYTHON="/opt/homebrew/Caskroom/miniconda/base/bin/python3"
fi
tmux send-keys -t "$SESSION" "$PYTHON '$PROXY'" Enter

echo "[start-perplexity-proxy] Started in tmux session '$SESSION'"
echo "  Attach:   tmux attach -t $SESSION"
echo "  Health:   curl http://127.0.0.1:4319/health"
echo "  Test:     curl -s http://127.0.0.1:4319/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"model\":\"perplexity\",\"messages\":[{\"role\":\"user\",\"content\":\"what is the capital of France\"}]}'"

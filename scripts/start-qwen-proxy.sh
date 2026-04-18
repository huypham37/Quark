#!/usr/bin/env bash
# start-qwen-proxy.sh — start qwen-web-proxy in a persistent tmux session

SESSION="qwen-proxy-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/qwen-web-proxy.py"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start-qwen-proxy] Session '$SESSION' already running."
  echo "  Attach: tmux attach -t $SESSION"
  echo "  Kill:   tmux kill-session -t $SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" "python3 '$PROXY'"
echo "[start-qwen-proxy] Started in tmux session '$SESSION'."
echo "  Attach: tmux attach -t $SESSION"
echo "  Kill:   tmux kill-session -t $SESSION"
echo "  Endpoint: http://127.0.0.1:4320/v1/chat/completions"

#!/usr/bin/env bash
# scripts/start-claude-proxy.sh
# Start the claude-web-proxy in a persistent tmux session.
# Usage: ./scripts/start-claude-proxy.sh [--port 4318]

set -e

SESSION="claude-proxy"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/claude-web-proxy.py"
PORT="${CLAUDE_PROXY_PORT:-4318}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start-claude-proxy] Session '$SESSION' already running."
  echo "  To restart: tmux kill-session -t $SESSION && $0"
  exit 0
fi

tmux new-session -d -s "$SESSION" \
  "while true; do
     echo '[proxy] Starting...'
     CLAUDE_PROXY_PORT=$PORT python3 '$SCRIPT' || true
     echo '[proxy] Crashed, restarting in 3s...'
     sleep 3
   done"

echo "[start-claude-proxy] Proxy started in tmux session '$SESSION' on port $PORT."
echo "  Logs:   tmux attach -t $SESSION"
echo "  Health: curl http://127.0.0.1:$PORT/health"
echo "  Stop:   tmux kill-session -t $SESSION"

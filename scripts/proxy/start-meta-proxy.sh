#!/usr/bin/env bash
# start-meta-proxy.sh — start meta-proxy in a persistent tmux session
#
# Requires META_RD_CHALLENGE and META_ECTO_SESS env vars.
# Get these from your browser cookies at meta.ai.

set -e

SESSION="meta-proxy-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$SCRIPT_DIR/meta-proxy.py"
PORT="${META_PROXY_PORT:-4321}"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start-meta-proxy] Session '$SESSION' already running."
  echo "  Attach: tmux attach -t $SESSION"
  echo "  Kill:   tmux kill-session -t $SESSION"
  exit 0
fi

if [ -z "$META_RD_CHALLENGE" ] || [ -z "$META_ECTO_SESS" ]; then
  echo "[start-meta-proxy] ERROR: Set META_RD_CHALLENGE and META_ECTO_SESS env vars."
  echo "  Get these from your browser cookies at meta.ai."
  exit 1
fi

tmux new-session -d -s "$SESSION" \
  "export META_RD_CHALLENGE='$META_RD_CHALLENGE'; \
   export META_ECTO_SESS='$META_ECTO_SESS'; \
   export META_PROXY_PORT=$PORT; \
   while true; do
     echo '[meta-proxy] Starting...'
     python3 '$PROXY' || true
     echo '[meta-proxy] Crashed, restarting in 3s...'
     sleep 3
   done"

echo "[start-meta-proxy] Proxy started in tmux session '$SESSION' on port $PORT."
echo "  Logs:   tmux attach -t $SESSION"
echo "  Health: curl http://127.0.0.1:$PORT/health"
echo "  Stop:   tmux kill-session -t $SESSION"

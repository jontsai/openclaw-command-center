#!/bin/bash
# Auto-restart loop for OpenClaw Command Center
# Keeps the dashboard running with exponential backoff on crashes

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${HOME}/.openclaw-command-center/logs"
LOG_FILE="${LOG_DIR}/dashboard.log"

mkdir -p "$LOG_DIR"

# Backoff settings
INITIAL_DELAY=1
MAX_DELAY=30
DELAY=$INITIAL_DELAY

cd "$DASHBOARD_DIR"

# Ensure node is available (nvm support)
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

echo "🦞 OpenClaw Command Center - Auto-restart loop"
echo "   Logs: $LOG_FILE"
echo "   Press Ctrl+C to stop"
echo ""

while true; do
    echo "[$(date)] Starting dashboard..." | tee -a "$LOG_FILE"
    
    # Run the server
    if node lib/server.js 2>&1 | tee -a "$LOG_FILE"; then
        # Clean exit
        echo "[$(date)] Dashboard exited cleanly" | tee -a "$LOG_FILE"
        DELAY=$INITIAL_DELAY
    else
        # Crash - backoff
        echo "[$(date)] Dashboard crashed! Restarting in ${DELAY}s..." | tee -a "$LOG_FILE"
        sleep $DELAY
        DELAY=$((DELAY * 2))
        if [ $DELAY -gt $MAX_DELAY ]; then
            DELAY=$MAX_DELAY
        fi
    fi
done

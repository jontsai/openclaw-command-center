#!/bin/bash
# Clawd Status Dashboard - tmux layout
# Creates a tmux session with live status panes

SESSION="openclaw-status"
OPENCLAW_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw-workspace}"

# Kill existing session if it exists
tmux kill-session -t "$SESSION" 2>/dev/null

# Create new session (detached)
tmux new-session -d -s "$SESSION" -c "$OPENCLAW_DIR"

# Rename first window
tmux rename-window -t "$SESSION:0" "dashboard"

# Layout:
# +------------------+------------------+
# |    Sessions      |   Cron Jobs      |
# +------------------+------------------+
# |    Gateway       |   Activity       |
# +------------------+------------------+

# Pane 0: Sessions (watch openclaw sessions)
tmux send-keys -t "$SESSION:0" "watch -n 10 -c 'echo \"📡 ACTIVE SESSIONS\"; echo; openclaw sessions 2>/dev/null || echo \"No sessions\"'" Enter

# Split horizontally for pane 1: Cron Jobs
tmux split-window -h -t "$SESSION:0" -c "$OPENCLAW_DIR"
tmux send-keys -t "$SESSION:0.1" "watch -n 30 -c 'echo \"⏰ CRON JOBS\"; echo; openclaw cron list 2>/dev/null || echo \"No cron jobs\"'" Enter

# Split pane 0 vertically for pane 2: Gateway Status
tmux split-window -v -t "$SESSION:0.0" -c "$OPENCLAW_DIR"
tmux send-keys -t "$SESSION:0.2" "watch -n 15 -c 'echo \"🤖 GATEWAY STATUS\"; echo; openclaw gateway status 2>/dev/null; echo; echo \"---\"; openclaw status 2>/dev/null'" Enter

# Split pane 1 vertically for pane 3: Activity Log
tmux split-window -v -t "$SESSION:0.1" -c "$OPENCLAW_DIR"
tmux send-keys -t "$SESSION:0.3" "watch -n 30 -c 'echo \"📝 RECENT ACTIVITY\"; echo; today=\$(date +%Y-%m-%d); if [ -f \"memory/\$today.md\" ]; then tail -20 \"memory/\$today.md\"; else echo \"No activity today\"; fi'" Enter

# Make panes more even
tmux select-layout -t "$SESSION:0" tiled

# Add a second window for logs
tmux new-window -t "$SESSION" -n "logs" -c "$OPENCLAW_DIR"
tmux send-keys -t "$SESSION:1" "echo '📜 Gateway Logs'; echo 'Run: openclaw gateway logs -f'; echo" Enter

# Add a third window for interactive shell
tmux new-window -t "$SESSION" -n "shell" -c "$OPENCLAW_DIR"
tmux send-keys -t "$SESSION:2" "echo '🐚 Interactive Shell'; echo 'Ready for commands...'; echo" Enter

# Go back to first window
tmux select-window -t "$SESSION:0"

echo "✅ OpenClaw dashboard created!"
echo ""
echo "To attach:  tmux attach -t $SESSION"
echo "To detach:  Ctrl+B, then D"
echo ""

# If not already in tmux, offer to attach
if [ -z "$TMUX" ]; then
    read -p "Attach now? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        tmux attach -t "$SESSION"
    fi
fi

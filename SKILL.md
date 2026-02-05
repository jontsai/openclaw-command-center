---
name: command-center
description: Real-time dashboard for OpenClaw. Monitor sessions, LLM usage, system vitals, and cron jobs. Zero config, auto-detects your workspace.
---

# OpenClaw Command Center

Real-time dashboard for your OpenClaw agents.

## Quick Start

```bash
# Install
clawhub install command-center

# Start
cd skills/command-center && node lib/server.js
```

**That's it.** Dashboard runs at http://localhost:3333

## What You'll See

- 📊 **Sessions** — Who's talking to your agents right now
- ⛽ **LLM Usage** — Token consumption, costs, quota remaining
- 💻 **System Vitals** — CPU, memory, disk health
- ⏰ **Cron Jobs** — Scheduled tasks and their status
- 🧠 **Cerebro** — Topics your agents are discussing

## Zero Config

Command Center **auto-detects** your OpenClaw workspace. No config file needed.

It looks for:
1. `$OPENCLAW_WORKSPACE` environment variable
2. `~/.openclaw-workspace` or `~/openclaw-workspace`
3. Common names: `~/molty`, `~/clawd`, `~/moltbot`

## Security

By default, only accessible from `localhost`. To expose remotely:

```bash
# Tailscale (recommended)
DASHBOARD_AUTH_MODE=tailscale node lib/server.js

# Token-based
DASHBOARD_AUTH_MODE=token DASHBOARD_TOKEN=your-secret node lib/server.js
```

## Optional: Run in Background

```bash
# Using make
make start    # Starts in tmux
make stop     # Stops the server
make status   # Check if running

# Or manually
nohup node lib/server.js &
```

## Configuration (Optional)

Most users don't need this. Environment variables for advanced use:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3333` |
| `OPENCLAW_WORKSPACE` | Workspace path | Auto-detect |
| `OPENCLAW_PROFILE` | Profile name | (none) |
| `DASHBOARD_AUTH_MODE` | Auth: `none`, `token`, `tailscale`, `cloudflare` | `none` |

## Requirements

- Node.js 18+ (no npm install needed)
- OpenClaw workspace

## Troubleshooting

**Dashboard shows no data?**
- Make sure OpenClaw is running and has active sessions
- Check that your workspace path is correct

**Can't connect?**
- Default port is 3333: http://localhost:3333
- Check if another process is using the port: `lsof -i:3333`

## Links

- [GitHub](https://github.com/jontsai/openclaw-command-center)
- [ClawHub](https://clawhub.ai/jontsai/command-center)

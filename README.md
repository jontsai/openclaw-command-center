# 🦞 OpenClaw Command Center

English | [简体中文](README.zh-CN.md)

<div align="center">

**Mission control for your AI agents**

[![CI](https://github.com/jontsai/openclaw-command-center/actions/workflows/ci.yml/badge.svg)](https://github.com/jontsai/openclaw-command-center/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![ClawHub](https://img.shields.io/badge/ClawHub-command--center-blue)](https://www.clawhub.ai/jontsai/command-center)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/jontsai/openclaw-command-center/pulls)

[Features](#features) • [Quick Start](#quick-start) • [Security](#-security) • [Configuration](#configuration)

</div>

---

## Why Command Center?

Your AI agents are running 24/7. You need to know what they're doing.

Command Center gives you **real-time visibility** into your OpenClaw deployment — sessions, costs, system health, scheduled tasks — all in one secure dashboard.

### ⚡ Fast

- **Single API call** — unified state endpoint, not 16+ separate requests
- **2-second updates** — real-time SSE push, not polling
- **5-second cache** — backend stays responsive under load
- **Instant startup** — no build step, no compilation

### 🪶 Lightweight

- **Zero dependencies** for users — just Node.js
- **~200KB total** — dashboard + server
- **No webpack/vite/bundler** — runs directly
- **No React/Vue/Angular** — vanilla JS, works everywhere

### 📱 Responsive

- **Desktop & mobile** — works on any screen size
- **Dark mode** — easy on the eyes, Starcraft-inspired
- **Live updates** — no manual refresh needed
- **Offline-friendly** — graceful degradation

### 🔧 Modern

- **ES Modules** — clean component architecture
- **SSE streaming** — efficient real-time updates
- **REST API** — integrate with your tools
- **TypeScript-ready** — JSDoc types included

### 🔒 Security (Most Important)

Command Center takes security seriously:

| Feature                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| **Auth Modes**           | Token, Tailscale, Cloudflare Access, IP allowlist   |
| **No external calls**    | Dashboard runs 100% locally — no telemetry, no CDNs |
| **Localhost default**    | Binds to `127.0.0.1` by default                     |
| **Read-only by default** | View your agents without exposing control           |
| **No secrets in UI**     | API keys, tokens never displayed                    |
| **Audit logging**        | Know who accessed what, when                        |

```bash
# Secure deployment example (Tailscale)
DASHBOARD_AUTH_MODE=tailscale node lib/server.js
# Only users on your Tailscale network can access
```

---

## Features

| Feature                    | Description                                 |
| -------------------------- | ------------------------------------------- |
| 📊 **Session Monitoring**  | Real-time view of active AI sessions        |
| ⛽ **LLM Fuel Gauges**     | Token usage, costs, quota remaining         |
| 💻 **System Vitals**       | CPU, memory, disk, temperature              |
| ⏰ **Cron Jobs**           | View and manage scheduled tasks             |
| 🧠 **Cerebro Topics**      | Automatic conversation tagging              |
| 👥 **Operators**           | Who's talking to your agents                |
| 📝 **Memory Browser**      | View agent memory files                     |
| 🔒 **Privacy Controls**    | Hide sensitive topics for demos/screenshots |
| 💰 **Cost Breakdown**      | Detailed per-model cost analysis            |
| 📈 **Savings Projections** | Monthly cost vs. manual estimates           |

---

## Quick Start

```bash
npx clawhub@latest install command-center
cd skills/command-center
node lib/server.js
```

**Dashboard runs at http://localhost:3333** 🎉

<details>
<summary>Alternative: Git clone</summary>

```bash
git clone https://github.com/jontsai/openclaw-command-center
cd openclaw-command-center
node lib/server.js
```

</details>

---

## Zero-Config Experience

Command Center **auto-detects** your OpenClaw workspace:

1. `$OPENCLAW_WORKSPACE` environment variable
2. `~/.openclaw-workspace` or `~/openclaw-workspace`
3. Common names: `~/molty`, `~/clawd`, `~/moltbot`

If you have `memory/` or `state/` directories, you're good to go.

---

## Optional System Dependencies

Command Center requires **only Node.js** to run. However, some system vitals features benefit from optional packages. Without them, the dashboard still works — those metrics simply show zeros or fall back gracefully.

| OS                    | Package             | Purpose                            | Install                                                       | Without It                        |
| --------------------- | ------------------- | ---------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| Linux                 | `sysstat`           | Disk I/O vitals (IOPS, throughput) | `sudo apt install sysstat`                                    | Disk stats show zeros             |
| Linux                 | `lm-sensors`        | Additional temperature sensors     | `sudo apt install lm-sensors`                                 | Uses thermal_zone (usually works) |
| macOS (Intel)         | `osx-cpu-temp`      | CPU temperature                    | [Build from source](https://github.com/lavoiesl/osx-cpu-temp) | Battery temp fallback             |
| macOS (Apple Silicon) | passwordless `sudo` | CPU temperature via `powermetrics` | Configure in sudoers                                          | Shows note in UI                  |

Command Center logs hints for missing optional dependencies once at startup.

---

## Configuration

### Environment Variables

| Variable             | Description    | Default     |
| -------------------- | -------------- | ----------- |
| `PORT`               | Server port    | `3333`      |
| `OPENCLAW_WORKSPACE` | Workspace root | Auto-detect |
| `OPENCLAW_PROFILE`   | Profile name   | (none)      |

### 🔒 Authentication

| Mode         | Use Case      | Config                                                    |
| ------------ | ------------- | --------------------------------------------------------- |
| `none`       | Local dev     | `DASHBOARD_AUTH_MODE=none`                                |
| `token`      | API access    | `DASHBOARD_AUTH_MODE=token DASHBOARD_TOKEN=secret`        |
| `tailscale`  | Team access   | `DASHBOARD_AUTH_MODE=tailscale`                           |
| `cloudflare` | Public deploy | `DASHBOARD_AUTH_MODE=cloudflare`                          |
| `allowlist`  | IP whitelist  | `DASHBOARD_AUTH_MODE=allowlist DASHBOARD_ALLOWED_IPS=...` |

### 📋 Recommended OpenClaw Settings

For the best Command Center experience, configure your OpenClaw gateway:

#### Slack Threading (Critical)

Enable threading for all messages to get proper topic tracking:

```yaml
# In your OpenClaw config (gateway.yaml or via openclaw gateway config)
slack:
  capabilities:
    threading: all # Options: all, dm, group, none
```

**Why this matters:** Without threading, the dashboard can't track conversation topics properly. Each thread becomes a trackable unit of work.

#### Session Labels

Use descriptive session labels for better dashboard visibility:

```yaml
sessions:
  labelFormat: "{channel}:{topic}" # Customize as needed
```

#### Cerebro (Topic Tracking)

Enable Cerebro for automatic conversation tagging:

```bash
# Initialize Cerebro directories
mkdir -p ~/your-workspace/cerebro/topics
mkdir -p ~/your-workspace/cerebro/orphans
```

The dashboard will automatically detect and display topic data.

---

### Multi-Profile Support

Running multiple OpenClaw instances?

```bash
# Production dashboard
node lib/server.js --profile production --port 3333

# Development dashboard
node lib/server.js --profile dev --port 3334
```

---

## API

Command Center exposes a REST API:

| Endpoint            | Description                                        |
| ------------------- | -------------------------------------------------- |
| `GET /api/state`    | **Unified state** — all dashboard data in one call |
| `GET /api/health`   | Health check                                       |
| `GET /api/vitals`   | System metrics                                     |
| `GET /api/sessions` | Active sessions                                    |
| `GET /api/events`   | SSE stream for real-time updates                   |

---

## Architecture

```
command-center/
├── lib/
│   ├── server.js           # HTTP server + API
│   ├── config.js           # Configuration
│   └── jobs.js             # Cron integration
├── public/
│   ├── index.html          # Dashboard UI
│   └── js/                 # Components (ES modules)
└── scripts/
    ├── setup.sh            # First-time setup
    └── verify.sh           # Health check
```

---

## 🚀 Coming Soon

### Advanced Job Scheduling

Building on OpenClaw's native cron system with intelligent scheduling primitives:

| Primitive            | Description                                 |
| -------------------- | ------------------------------------------- |
| **run-if-not**       | Skip if job already running (dedupe)        |
| **run-if-idle**      | Only execute when system capacity available |
| **run-after**        | Dependency chains between jobs              |
| **run-with-backoff** | Exponential retry on failure                |
| **priority-queue**   | Critical vs. background work prioritization |

### Multi-Agent Orchestration

- Agent-to-agent handoffs
- Swarm coordination patterns
- Specialized agent routing (data analysis, documentation, testing)
- Cross-session context sharing

### Integration Ecosystem

- Webhook triggers for external systems
- Slack slash commands for quick actions
- API for custom integrations
- Plugin architecture for specialized agents

---

## Screenshots

### Dashboard Overview

The hero view shows key metrics at a glance: total tokens, costs, active sessions, estimated savings, and system capacity.

<p align="center">
  <img src="docs/screenshots/hero.png" alt="Dashboard Hero" width="800">
</p>

### Sessions Panel

Monitor all active AI sessions in real-time. Each card shows model, channel, token usage, cost, and activity status. Filter by status (live/recent/idle), channel, or session type.

<p align="center">
  <img src="docs/screenshots/sessions-panel.png" alt="Sessions Panel" width="800">
</p>

### Cron Jobs

View and manage scheduled tasks. See run history, next scheduled time, and enable/disable jobs. The dashboard shows job success/failure sparklines and filters by status and schedule type.

<p align="center">
  <img src="docs/screenshots/cron-panel.png" alt="Cron Jobs Panel" width="800">
</p>

### Cerebro Topics

Automatic conversation organization. Topics are auto-detected from Slack threads, with status tracking (active/resolved/parked), thread counts, and quick navigation. Privacy controls let you hide sensitive topics.

<p align="center">
  <img src="docs/screenshots/cerebro-panel.png" alt="Cerebro Topics Panel" width="800">
</p>

### Operators

See who's interacting with your AI agents. Track active sessions per operator, permission levels, and last activity timestamps.

<p align="center">
  <img src="docs/screenshots/operators-panel.png" alt="Operators Panel" width="800">
</p>

### Memory Browser

Browse your agent's memory files — daily logs, long-term memory, and workspace files. Quick navigation with file sizes and modification times.

<p align="center">
  <img src="docs/screenshots/memory-panel.png" alt="Memory Panel" width="800">
</p>

### Cost Breakdown Modal

Click on any cost stat to see detailed breakdowns: token usage by type, pricing rates, and calculation methodology. Includes estimated savings vs. manual work.

<p align="center">
  <img src="docs/screenshots/cost-modal.png" alt="Cost Breakdown Modal" width="800">
</p>

### Operator Details

Click on an operator card to see their session history, stats, and activity timeline.

<p align="center">
  <img src="docs/screenshots/operator-modal.png" alt="Operator Details Modal" width="800">
</p>

### Privacy Settings

Control what's visible for demos and screenshots. Hide sensitive topics, sessions, or cron jobs. Settings sync to the server automatically.

<p align="center">
  <img src="docs/screenshots/privacy-modal.png" alt="Privacy Settings Modal" width="800">
</p>

### Session Details

Click any session card to see detailed information: summary, key facts, tools used, and recent messages.

<p align="center">
  <img src="docs/screenshots/session-detail.png" alt="Session Details Panel" width="800">
</p>

### Full Dashboard

The complete dashboard with all panels visible.

<details>
<summary>Click to expand full dashboard view</summary>
<p align="center">
  <img src="docs/screenshots/dashboard-full.png" alt="Full Dashboard" width="800">
</p>
</details>

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md).

### Development

```bash
npm install        # Install dev dependencies
npm run dev        # Watch mode
npm run lint       # Check code style
npm run format     # Auto-format
./scripts/verify.sh  # Run health checks
```

---

## License

MIT © [Jonathan Tsai](https://github.com/jontsai)

---

<div align="center">

**[Install from ClawHub](https://www.clawhub.ai/jontsai/command-center)** · **[OpenClaw](https://github.com/openclaw/openclaw)** · **[Discord](https://discord.gg/clawd)**

</div>

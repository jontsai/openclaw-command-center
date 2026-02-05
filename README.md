# 🦞 OpenClaw Command Center

<div align="center">

**Mission control for your AI agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ClawHub](https://img.shields.io/badge/ClawHub-command--center-blue)](https://www.clawhub.ai/jontsai/command-center)

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

| Feature | Description |
|---------|-------------|
| **Auth Modes** | Token, Tailscale, Cloudflare Access, IP allowlist |
| **No external calls** | Dashboard runs 100% locally — no telemetry, no CDNs |
| **Localhost default** | Binds to `127.0.0.1` by default |
| **Read-only by default** | View your agents without exposing control |
| **No secrets in UI** | API keys, tokens never displayed |
| **Audit logging** | Know who accessed what, when |

```bash
# Secure deployment example (Tailscale)
DASHBOARD_AUTH_MODE=tailscale node lib/server.js
# Only users on your Tailscale network can access
```

---

## Features

| Feature | Description |
|---------|-------------|
| 📊 **Session Monitoring** | Real-time view of active AI sessions |
| ⛽ **LLM Fuel Gauges** | Token usage, costs, quota remaining |
| 💻 **System Vitals** | CPU, memory, disk, temperature |
| ⏰ **Cron Jobs** | View and manage scheduled tasks |
| 🧠 **Cerebro Topics** | Automatic conversation tagging |
| 👥 **Operators** | Who's talking to your agents |
| 📝 **Memory Browser** | View agent memory files |

---

## Quick Start

### Option 1: ClawHub (Recommended)

```bash
clawhub install command-center
cd skills/command-center
node lib/server.js
```

### Option 2: Git Clone

```bash
git clone https://github.com/jontsai/openclaw-command-center
cd openclaw-command-center
npm install  # Optional: only for dev tools
node lib/server.js
```

### Option 3: One-liner

```bash
npx degit jontsai/openclaw-command-center dashboard && cd dashboard && node lib/server.js
```

**Dashboard runs at http://localhost:3333** 🎉

---

## Zero-Config Experience

Command Center **auto-detects** your OpenClaw workspace:

1. `$OPENCLAW_WORKSPACE` environment variable
2. `~/.openclaw-workspace` or `~/openclaw-workspace`
3. Common names: `~/molty`, `~/clawd`, `~/moltbot`

If you have `memory/` or `state/` directories, you're good to go.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3333` |
| `OPENCLAW_WORKSPACE` | Workspace root | Auto-detect |
| `OPENCLAW_PROFILE` | Profile name | (none) |

### 🔒 Authentication

| Mode | Use Case | Config |
|------|----------|--------|
| `none` | Local dev | `DASHBOARD_AUTH_MODE=none` |
| `token` | API access | `DASHBOARD_AUTH_MODE=token DASHBOARD_TOKEN=secret` |
| `tailscale` | Team access | `DASHBOARD_AUTH_MODE=tailscale` |
| `cloudflare` | Public deploy | `DASHBOARD_AUTH_MODE=cloudflare` |
| `allowlist` | IP whitelist | `DASHBOARD_AUTH_MODE=allowlist DASHBOARD_ALLOWED_IPS=...` |

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

| Endpoint | Description |
|----------|-------------|
| `GET /api/state` | **Unified state** — all dashboard data in one call |
| `GET /api/health` | Health check |
| `GET /api/vitals` | System metrics |
| `GET /api/sessions` | Active sessions |
| `GET /api/events` | SSE stream for real-time updates |

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

## Screenshots

*Coming soon*

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

**[ClawHub](https://clawhub.ai)** · **[OpenClaw](https://github.com/openclaw/openclaw)** · **[Discord](https://discord.gg/clawd)**

</div>

# OpenClaw Command Center — Architecture Overview

> _"The Overmind sees all through its Overlords."_

## Overview

OpenClaw Command Center is a real-time dashboard for monitoring and managing AI assistant orchestration. It provides visibility into sessions, token usage, costs, scheduled jobs, and system health.

## Core Architecture Principles

### 1. **DRY (Don't Repeat Yourself)**
- Shared components extracted to reusable partials
- Single source of truth for sidebar, styling, and common logic
- Centralized configuration management

### 2. **Real-Time First**
- Server-Sent Events (SSE) for live updates
- No polling needed for connected clients
- Graceful degradation to polling when SSE unavailable

### 3. **Zero Build Step**
- Plain HTML, CSS, and JavaScript
- No compilation, bundling, or transpilation required
- Works directly from static file serving
- Dynamic loading via fetch() for shared partials

### 4. **Progressive Enhancement**
- Core functionality works without JavaScript
- Enhanced UX with JS (smooth scrolling, live updates, etc.)
- Mobile-responsive design

### 5. **Thematic Consistency**
- Starcraft/Zerg theme throughout
- Dark mode by default (space aesthetic)
- Consistent naming conventions

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client)                         │
├─────────────────────────────────────────────────────────────┤
│  index.html          │  jobs.html         │  (future pages) │
│  ─────────────       │  ─────────────     │                 │
│  Main Dashboard      │  AI Jobs Dashboard │                 │
└──────────┬───────────┴────────┬──────────┴─────────────────┘
           │                    │
           │  ┌─────────────────┴──────────────────┐
           │  │  /partials/sidebar.html            │
           │  │  (shared navigation component)      │
           │  └─────────────────┬──────────────────┘
           │                    │
           └────────────────────┼──────────────────────────────┐
                                │                              │
┌───────────────────────────────┴──────────────────────────────┤
│                    /js/sidebar.js                            │
│  ─ Loads sidebar partial                                     │
│  ─ Manages SSE connection for live badge updates             │
│  ─ Handles navigation and active state                       │
└──────────────────────────────────────────────────────────────┘
                                │
                                │ SSE (/api/events)
                                │ REST (/api/*)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    lib/server.js                             │
│  ─ Express HTTP server                                       │
│  ─ SSE event broadcasting                                    │
│  ─ API routes for state, sessions, jobs, etc.                │
│  ─ Static file serving                                       │
└─────────────────────────────────┬────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │ OpenClaw  │ │   Jobs    │ │  Linear   │
            │  Gateway  │ │ Scheduler │ │   Sync    │
            │   API     │ │   API     │ │   API     │
            └───────────┘ └───────────┘ └───────────┘
```

## Frontend Architecture

### Pages
| Page | Purpose | Key Sections |
|------|---------|--------------|
| `index.html` | Main dashboard | Vitals, LLM Usage, Sessions, Cron Jobs, Memory, Cerebro, Operators |
| `jobs.html` | AI Jobs management | Job cards, run/pause/history controls |

### Shared Components
| Component | Location | Purpose |
|-----------|----------|---------|
| Sidebar | `/partials/sidebar.html` | Navigation + live stats badges |
| Sidebar JS | `/js/sidebar.js` | Partial loading, SSE connection, navigation |
| Styles | `/css/dashboard.css` | Shared visual theme |
| morphdom | `/js/lib/morphdom.min.js` | Efficient DOM diffing |

### State Management
- **SSE-based**: Real-time state pushed from server
- **Local state**: Per-component state in JavaScript closures
- **Persistence**: `localStorage` for preferences (sidebar collapsed, etc.)

## Backend Architecture

### Server (`lib/server.js`)
- Express.js HTTP server
- Static file serving from `/public`
- API routes under `/api/*`
- SSE endpoint at `/api/events`

### Data Sources
| Source | Integration | Purpose |
|--------|-------------|---------|
| OpenClaw Gateway | REST API | Sessions, token stats, system vitals |
| Jobs Scheduler | REST API | AI job definitions and run history |
| Linear | GraphQL API | Issue tracking integration |

### Configuration (`lib/config.js`)
- Auto-detects OpenClaw installation paths
- Supports multiple config file locations
- Environment variable overrides

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET (SSE) | Real-time state updates |
| `/api/state` | GET | Full current state snapshot |
| `/api/sessions` | GET | Session list and details |
| `/api/jobs` | GET | AI job definitions |
| `/api/jobs/:id/run` | POST | Trigger job execution |
| `/api/jobs/:id/pause` | POST | Pause job |
| `/api/jobs/:id/resume` | POST | Resume job |
| `/api/jobs/:id/history` | GET | Job run history |

## Design Decisions

### ADR-001: Shared Sidebar via Fetch
**Decision**: Load sidebar HTML via `fetch()` rather than server-side includes or build step.

**Rationale**:
- Keeps zero-build-step architecture
- Works with any static file server
- Enables dynamic loading and hot updates
- Single source of truth for sidebar content

### ADR-002: SSE for Real-Time Updates
**Decision**: Use Server-Sent Events instead of WebSockets.

**Rationale**:
- Simpler protocol (HTTP-based)
- Automatic reconnection
- Better proxy/firewall compatibility
- Sufficient for server→client push (no bidirectional needed)

### ADR-003: Morphdom for DOM Updates
**Decision**: Use morphdom for efficient DOM patching.

**Rationale**:
- Virtual DOM-like efficiency without framework overhead
- Preserves focus, scroll position, form state
- Small footprint (~4KB)

## File Structure

```
openclaw-command-center/
├── lib/                        # Backend code
│   ├── server.js               # Main HTTP server
│   ├── config.js               # Configuration loader
│   ├── jobs.js                 # Jobs API integration
│   ├── linear-sync.js          # Linear integration
│   └── topic-classifier.js     # NLP topic classification
├── public/                     # Frontend (served statically)
│   ├── index.html              # Main dashboard
│   ├── jobs.html               # AI Jobs dashboard
│   ├── partials/               # Shared HTML partials
│   │   └── sidebar.html        # Navigation sidebar
│   ├── css/
│   │   └── dashboard.css       # Shared styles
│   ├── js/
│   │   ├── sidebar.js          # Sidebar loader + SSE
│   │   ├── app.js              # Main page logic
│   │   ├── api.js              # API client utilities
│   │   ├── store.js            # State management
│   │   ├── utils.js            # Common utilities
│   │   └── lib/
│   │       └── morphdom.min.js # DOM diffing library
│   └── data/                   # Client-side data cache
├── config/                     # Configuration files
├── docs/                       # Documentation
│   └── architecture/           # Architecture docs
├── scripts/                    # Operational scripts
└── tests/                      # Test files
```

## Performance Considerations

1. **SSE Connection Sharing**: Single SSE connection per page, shared across components
2. **Lazy Loading**: Sidebar loaded on demand, not blocking initial render
3. **Efficient Updates**: morphdom patches only changed DOM nodes
4. **Debouncing**: High-frequency updates batched before render

## Security Considerations

1. **No Secrets in Frontend**: All sensitive data stays server-side
2. **Input Validation**: API inputs validated before processing
3. **CORS**: Restricted to same-origin by default
4. **Rate Limiting**: Consider for public deployments

## Future Directions

1. **Component System**: More shared partials (stats bar, modals, etc.)
2. **Plugin Architecture**: Extensible dashboard sections
3. **Multi-Gateway**: Support for monitoring multiple OpenClaw instances
4. **Historical Analytics**: Token usage and cost trends over time

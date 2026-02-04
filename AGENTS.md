# AGENTS.md — AI Workspace Guide

> _"The Overmind speaks through many voices, but with one purpose."_

Welcome, AI agent. This document defines how you should interact with this codebase.

## 🎯 Mission

OpenClaw Command Center is the central dashboard for AI assistant management. Your mission is to help build, maintain, and improve this system while maintaining the Starcraft/Zerg thematic elements that make it unique.

## 📁 Workspace Structure

```
openclaw-command-center/
├── lib/                    # Core server logic
│   ├── server.js           # Main HTTP server and API routes
│   ├── config.js           # Configuration loader with auto-detection
│   ├── jobs.js             # Jobs/scheduler API integration
│   ├── linear-sync.js      # Linear issue tracker integration
│   └── topic-classifier.js # NLP-based topic classification
├── public/                 # Frontend assets
│   ├── index.html          # Main dashboard UI
│   └── jobs.html           # Jobs management UI
├── scripts/                # Operational scripts
│   ├── setup.sh            # First-time setup
│   ├── start.sh            # Start server (with optional tunnel)
│   ├── stop.sh             # Stop server
│   └── tmux-dashboard.sh   # Multi-pane tmux layout
├── config/                 # Configuration (be careful!)
│   └── dashboard.example.json
├── docs/                   # Documentation
├── tests/                  # Test files
├── SKILL.md                # ClawHub skill metadata
└── package.json            # Version and dependencies
```

## ✅ Safe Operations

Do freely:

- Read any file to understand the codebase
- Create/modify files in `lib/`, `public/`, `docs/`, `tests/`
- Add tests
- Update documentation
- Create feature branches

## ⚠️ Ask First

Check with a human before:

- Modifying `config/` files
- Changing CI/CD workflows
- Adding new dependencies to `package.json`
- Making breaking API changes
- Anything touching authentication/secrets

## 🚫 Never

- Commit secrets, API keys, or credentials
- Delete files without confirmation
- Push directly to `main` branch
- Expose internal endpoints publicly

## 🛠️ Development Workflow

### 1. Feature Development

```bash
# Create feature branch
git checkout -b feat/your-feature-name

# Make changes, then test locally
npm test
npm run lint

# Commit with descriptive message
git commit -m "feat: add overlord status indicator"

# Push and create PR
git push -u origin feat/your-feature-name
```

### 2. Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `style:` — Formatting, no code change
- `refactor:` — Code restructuring
- `test:` — Adding tests
- `chore:` — Maintenance tasks

### 3. Code Style

- Use ESLint configuration provided
- Prettier for formatting
- JSDoc comments for public functions
- Meaningful variable names (thematic names encouraged!)

## 📦 ClawHub Skill Workflow

This project is distributed as a ClawHub skill. After changes are merged to `main`, they need to be published to the registry so users can install/update via `clawhub install command-center`.

### Understanding Skill Metadata

Two files control the skill identity:

- **`SKILL.md`** — Frontmatter (`name`, `description`) used by ClawHub for discovery and search
- **`package.json`** — `version` field is the source of truth for the published version

### Publishing Updates

```bash
# 1. Authenticate (one-time)
clawhub login
clawhub whoami

# 2. Bump version in package.json (follow semver)
#    patch: bug fixes         (0.1.0 → 0.1.1)
#    minor: new features      (0.1.0 → 0.2.0)
#    major: breaking changes  (0.1.0 → 1.0.0)

# 3. Publish
clawhub publish . --slug command-center --version <new-version> \
  --changelog "Description of what changed"

# Or auto-detect changes and bump:
clawhub sync --bump patch --changelog "Description of what changed"
```

> **Registry URL workaround:** If you hit connection or redirect errors,
> override the registry:
>
> ```bash
> export CLAWHUB_REGISTRY=https://www.clawhub.ai
> ```
>
> This is needed until the upstream `.well-known` redirect is fixed.

### Verifying a Publish

```bash
# Check published metadata
clawhub inspect command-center

# Test install into a workspace
clawhub install command-center --workdir /path/to/workspace
```

### Updating an Installed Skill

Users update with:

```bash
clawhub update command-center
```

The installed version is tracked in `.clawhub/origin.json` within the skill directory.

## 🎨 Thematic Guidelines

This project has a Starcraft/Zerg theme. When naming things:

| Concept            | Thematic Name |
| ------------------ | ------------- |
| Main controller    | Overmind      |
| Worker processes   | Drones        |
| Monitoring service | Overlord      |
| Cache layer        | Creep         |
| Message queue      | Spawning Pool |
| Health check       | Essence scan  |
| Error state        | Corrupted     |

Example:

```javascript
// Instead of: const cacheService = new Cache();
const creepLayer = new CreepCache();

// Instead of: function checkHealth()
function scanEssence()
```

## 📝 Documentation Standards

When you add features, document them:

1. **Code comments** — JSDoc for functions
2. **README updates** — If user-facing
3. **API docs** — In `docs/api/` for endpoints
4. **Architecture Decision Records** — In `docs/architecture/` for major changes

## 🧪 Testing

```bash
# Run all tests
npm test

# Coverage report
npm run test:coverage
```

Aim for meaningful test coverage. Test the logic, not the framework.

## 🐛 Debugging

```bash
# Enable all command-center debug output
DEBUG=openclaw:* npm run dev

# Specific namespaces
DEBUG=openclaw:api npm run dev
DEBUG=openclaw:overlord npm run dev
```

## 🔄 Handoff Protocol

When handing off to another AI or ending a session:

1. Commit all work in progress
2. Document current state in a comment or commit message
3. List any unfinished tasks
4. Note any decisions that need human input

## 📚 Key Resources

- [SKILL.md](./SKILL.md) — ClawHub skill metadata
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guidelines
- [docs/](./docs/) — Detailed documentation

---

_"Awaken, my child, and embrace the glory that is your birthright."_

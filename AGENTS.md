# AGENTS.md — AI Workspace Guide

> _"The Overmind speaks through many voices, but with one purpose."_

Welcome, AI agent. This document defines how you should interact with this codebase.

## ⚠️ CRITICAL: Pull Request Workflow

**All changes to this repository MUST go through pull requests.**

This is a public open source project. Even maintainers (including AI agents working on behalf of maintainers) must:

1. Create a feature branch (`git checkout -b type/description`)
2. Make changes and commit
3. Push branch and open a PR
4. Get approval before merging

**Never push directly to `main`.** This applies to everyone, including the repo owner.

## 🎯 Mission

OpenClaw Command Center is the central dashboard for AI assistant management. Your mission is to help build, maintain, and improve this system while maintaining the Starcraft/Zerg thematic elements that make it unique.

## 🏛️ Architecture

**Read First**: [`docs/architecture/OVERVIEW.md`](docs/architecture/OVERVIEW.md)

Key architectural principles:
1. **DRY** — Don't Repeat Yourself. Extract shared code to partials/modules.
2. **Zero Build Step** — Plain HTML/CSS/JS, no compilation needed.
3. **Real-Time First** — SSE for live updates, polling as fallback.
4. **Progressive Enhancement** — Works without JS, enhanced with JS.

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
│   ├── jobs.html           # AI Jobs management UI
│   ├── partials/           # ⭐ Shared HTML partials (DRY!)
│   │   └── sidebar.html    # Navigation sidebar component
│   ├── css/
│   │   └── dashboard.css   # Shared styles
│   └── js/
│       ├── sidebar.js      # Sidebar loader + SSE badges
│       ├── app.js          # Main dashboard logic
│       └── lib/            # Third-party libraries
├── scripts/                # Operational scripts
├── config/                 # Configuration (be careful!)
├── docs/                   # Documentation
│   └── architecture/       # Architecture Decision Records
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

- **Push directly to `main` branch** — ALL changes require PRs
- Commit secrets, API keys, or credentials
- Commit user-specific data files (see `public/data/AGENTS.md`)
- Delete files without confirmation
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

# 3. Tag the release
git tag -a v<new-version> -m "v<new-version> — short description"
git push origin --tags

# 4. Publish (--registry flag required until upstream redirect is fixed)
clawhub publish . --registry https://www.clawhub.ai \
  --slug command-center --version <new-version> \
  --changelog "Description of what changed"
```

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

### Who Can Publish?

Only maintainers with ClawHub credentials for `jontsai/command-center` can publish. Currently:
- @jontsai (owner)

Contributors: Submit PRs. After merge, a maintainer will handle the ClawHub publish.

### Release Checklist

Before publishing a new version:

1. [ ] All PRs for the release are merged to `main`
2. [ ] Version bumped in both `package.json` and `SKILL.md` frontmatter
3. [ ] CHANGELOG updated (if maintained)
4. [ ] Tests pass: `npm test`
5. [ ] Lint passes: `npm run lint`
6. [ ] Git tag created: `git tag -a v<version> -m "v<version>"`
7. [ ] Tag pushed: `git push origin --tags`
8. [ ] Published to ClawHub with changelog

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

## 📖 Lessons Learned

### DRY is Non-Negotiable
**Problem**: Sidebar was duplicated across `index.html` and `jobs.html`, causing inconsistencies.
**Solution**: Extract to `/partials/sidebar.html` + `/js/sidebar.js` for loading.
**Lesson**: When you see similar code in multiple places, stop and extract it. The cost of extraction is always lower than maintaining duplicates.

### Naming Consistency Matters
**Problem**: "Scheduled Jobs" vs "Cron Jobs" vs "Jobs" caused confusion.
**Solution**: Established naming convention: "Cron Jobs" for OpenClaw scheduled tasks, "AI Jobs" for advanced agent jobs.
**Lesson**: Agree on terminology early. Document it. Enforce it.

### Zero-Build Architecture Has Trade-offs
**Context**: No build step keeps things simple but limits some patterns.
**Solution**: Use `fetch()` to load partials dynamically, `<script>` for shared JS.
**Lesson**: This works well for dashboards. Evaluate trade-offs for your use case.

### SSE Connection Per Component = Wasteful
**Problem**: Multiple components each opening SSE connections.
**Solution**: Single SSE connection in `sidebar.js`, shared state management.
**Lesson**: Centralize real-time connections. Components subscribe to state, not sources.

### Test After Every Significant Change
**Problem**: Easy to break things when refactoring HTML structure.
**Solution**: `make restart` + browser check after each change.
**Lesson**: Keep feedback loops tight. Visual changes need visual verification.

### Document Architectural Decisions
**Problem**: Future agents (or humans) don't know why things are the way they are.
**Solution**: Create `docs/architecture/OVERVIEW.md` and ADRs.
**Lesson**: Write down the "why", not just the "what".

## 📚 Key Resources

- [SKILL.md](./SKILL.md) — ClawHub skill metadata
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guidelines
- [docs/](./docs/) — Detailed documentation

---

_"Awaken, my child, and embrace the glory that is your birthright."_

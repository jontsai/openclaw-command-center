# Floating Glass Dock Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing static `public/` UI with a glassmorphism visual system and a bottom floating dock that replaces the fixed left sidebar.

**Architecture:** Keep the current zero-build static UI and current API/SSE behavior. Replace the shared sidebar partial with a shared command dock, update `public/js/sidebar.js` into a dock/shell controller while retaining existing global compatibility hooks, and consolidate visual styling in `public/css/dashboard.css`.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Server-Sent Events, existing `node:test` tests, existing i18n attributes.

---

## File Structure

- Modify `public/partials/sidebar.html`: keep the path for compatibility, but replace the visible sidebar with the floating command dock and More menu.
- Modify `public/js/sidebar.js`: keep the loader, SSE badge updates, jobs count fetch, i18n refresh, and navigation logic; change active-state and menu behavior for dock controls.
- Modify `public/css/dashboard.css`: define glass tokens, page background, dock styles, shell/header styles, shared cards, panels, filters, buttons, modals, and responsive bottom-safe spacing.
- Modify `public/index.html`: remove sidebar-specific mobile toggle markup, add shell-friendly header classes, and keep existing section anchors and IDs.
- Modify `public/jobs.html`: remove duplicated sidebar/header/stats CSS from the inline style, link shared dashboard styles, update header classes, and keep existing jobs script behavior.
- Create `tests/glass-dock-ui.test.js`: static guardrails for the dock partial, CSS shell, and page integration.

Do not modify `lib/server.js`, `src/index.js`, React/Vite files, package files, auth, secrets, or `config/` as part of this redesign.

## Task 1: Static Guardrail Tests

**Files:**
- Create: `tests/glass-dock-ui.test.js`

- [ ] **Step 1: Write the failing static UI tests**

Create `tests/glass-dock-ui.test.js` with this content:

```javascript
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("glass dock UI shell", () => {
  const partial = read("public/partials/sidebar.html");
  const dashboardCss = read("public/css/dashboard.css");
  const indexHtml = read("public/index.html");
  const jobsHtml = read("public/jobs.html");
  const shellJs = read("public/js/sidebar.js");

  it("replaces the fixed sidebar with a command dock partial", () => {
    assert.match(partial, /class="command-dock"/);
    assert.match(partial, /aria-label="Command navigation"/);
    assert.match(partial, /href="#vitals-section"/);
    assert.match(partial, /href="#llm-section"/);
    assert.match(partial, /href="#sessions-section"/);
    assert.match(partial, /href="#cron-section"/);
    assert.match(partial, /href="#memory-section"/);
    assert.match(partial, /href="\/jobs\.html"/);
    assert.match(partial, /id="command-more-toggle"/);
    assert.match(partial, /id="command-more-menu"/);
    assert.doesNotMatch(partial, /class="sidebar"/);
  });

  it("defines the shared glass visual system and bottom dock layout", () => {
    assert.match(dashboardCss, /--glass-panel:/);
    assert.match(dashboardCss, /--dock-height:/);
    assert.match(dashboardCss, /backdrop-filter: blur/);
    assert.match(dashboardCss, /\.command-dock/);
    assert.match(dashboardCss, /\.command-more-menu/);
    assert.match(dashboardCss, /\.main-wrapper\s*{[^}]*margin-left:\s*0/s);
    assert.doesNotMatch(dashboardCss, /--sidebar-width/);
  });

  it("integrates the shared shell on dashboard and jobs pages", () => {
    assert.match(indexHtml, /id="sidebar-container"/);
    assert.match(jobsHtml, /id="sidebar-container"/);
    assert.match(indexHtml, /<script src="js\/sidebar\.js"><\/script>/);
    assert.match(jobsHtml, /<script src="\/js\/sidebar\.js"><\/script>/);
    assert.doesNotMatch(indexHtml, /id="mobile-menu-btn"/);
    assert.doesNotMatch(jobsHtml, /\.sidebar\s*{/);
  });

  it("keeps shell behavior names used by current pages", () => {
    assert.match(shellJs, /function setActiveNavItem/);
    assert.match(shellJs, /function setupNavigation/);
    assert.match(shellJs, /window\.toggleSidebar/);
    assert.match(shellJs, /window\.toggleCommandDockMore/);
    assert.match(shellJs, /nav-jobs-count/);
    assert.match(shellJs, /sidebar-updated/);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: the test fails because the current partial still contains `.sidebar`, the CSS still has `--sidebar-width`, and the dock classes do not exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/glass-dock-ui.test.js
git commit -m "test: add glass dock ui guardrails"
```

## Task 2: Shared Command Dock Partial

**Files:**
- Modify: `public/partials/sidebar.html`

- [ ] **Step 1: Replace the sidebar partial with the dock markup**

Replace the full contents of `public/partials/sidebar.html` with:

```html
<!-- Shared Command Dock Partial -->
<nav class="command-dock" id="command-dock" aria-label="Command navigation">
  <a class="dock-brand" href="/" data-page="/" aria-label="OpenClaw Command Center">
    <span class="dock-brand-mark">OC</span>
    <span class="dock-brand-text" data-i18n="sidebar.title">Command Center</span>
  </a>

  <div class="dock-links" role="list">
    <a
      href="#vitals-section"
      class="dock-item"
      data-section="vitals"
      data-page="/"
      data-tooltip="System Vitals"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">Vitals</span>
      <span class="dock-label" data-i18n="sidebar.systemVitals">Vitals</span>
    </a>
    <a
      href="#llm-section"
      class="dock-item"
      data-section="llm"
      data-page="/"
      data-tooltip="LLM Usage"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">LLM</span>
      <span class="dock-label" data-i18n="sidebar.llmUsage">LLM</span>
    </a>
    <a
      href="#sessions-section"
      class="dock-item"
      data-section="sessions"
      data-page="/"
      data-tooltip="Sessions"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">Sess</span>
      <span class="dock-label" data-i18n="sidebar.sessions">Sessions</span>
      <span class="dock-badge" id="nav-session-count">-</span>
    </a>
    <a
      href="#cron-section"
      class="dock-item"
      data-section="cron"
      data-page="/"
      data-tooltip="Cron Jobs"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">Cron</span>
      <span class="dock-label" data-i18n="sidebar.cronJobs">Cron</span>
      <span class="dock-badge" id="nav-cron-count">-</span>
    </a>
    <a
      href="#memory-section"
      class="dock-item"
      data-section="memory"
      data-page="/"
      data-tooltip="Memory"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">Mem</span>
      <span class="dock-label" data-i18n="sidebar.memory">Memory</span>
      <span class="dock-badge" id="nav-memory-count">-</span>
    </a>
    <a
      href="/jobs.html"
      class="dock-item"
      data-page="/jobs.html"
      data-tooltip="AI Jobs Dashboard"
      role="listitem"
    >
      <span class="dock-icon" aria-hidden="true">Jobs</span>
      <span class="dock-label" data-i18n="sidebar.aiJobs">AI Jobs</span>
      <span class="dock-badge" id="nav-jobs-count">-</span>
    </a>
  </div>

  <div class="dock-more">
    <button
      class="dock-item dock-more-toggle"
      id="command-more-toggle"
      type="button"
      aria-haspopup="true"
      aria-expanded="false"
      aria-controls="command-more-menu"
      onclick="toggleCommandDockMore()"
    >
      <span class="dock-icon" aria-hidden="true">More</span>
      <span class="dock-label">More</span>
    </button>
    <div class="command-more-menu" id="command-more-menu" hidden>
      <a href="#cerebro-section" class="dock-menu-item" data-section="cerebro" data-page="/">
        <span data-i18n="sidebar.cerebro">Cerebro</span>
        <span class="dock-badge" id="nav-cerebro-count">-</span>
      </a>
      <a href="#operators-section" class="dock-menu-item" data-section="operators" data-page="/">
        <span data-i18n="sidebar.operators">Operators</span>
        <span class="dock-badge" id="nav-operator-count">-</span>
      </a>
      <button
        type="button"
        class="dock-menu-item"
        onclick="window.openPrivacyModal && openPrivacyModal(); closeCommandDockMore();"
      >
        <span data-i18n="sidebar.privacy">Privacy</span>
      </button>
      <a href="#about-section" class="dock-menu-item" data-section="about" data-page="/">
        <span data-i18n="sidebar.about">About</span>
      </a>
      <button
        type="button"
        class="dock-menu-item"
        onclick="window.openCostModal && openCostModal(); closeCommandDockMore();"
      >
        <span data-i18n="sidebar.estDaily">Est. Daily</span>
        <span class="dock-badge" id="nav-cost">-</span>
      </button>
      <div class="dock-menu-readout">
        <span data-i18n="sidebar.tokens">Tokens</span>
        <strong id="nav-tokens">-</strong>
      </div>
      <div class="dock-menu-readout">
        <span data-i18n="sidebar.estMonthly">Est. Monthly</span>
        <strong id="nav-monthly-cost">-</strong>
      </div>
      <div class="dock-menu-readout">
        <span data-i18n="sidebar.avgTokSess">Avg Tok/Sess</span>
        <strong id="nav-avg-tokens">-</strong>
      </div>
      <div class="dock-menu-readout">
        <span data-i18n="sidebar.avgCostSess">Avg $/Sess</span>
        <strong id="nav-avg-cost">-</strong>
      </div>
    </div>
  </div>

  <div class="dock-sync" title="Live refresh status">
    <span class="dock-sync-dot" aria-hidden="true"></span>
    <span id="sidebar-updated">-</span>
  </div>
</nav>
```

- [ ] **Step 2: Run the partial-focused test**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: the first test advances past the partial assertions. CSS and JS assertions still fail.

- [ ] **Step 3: Commit the partial**

```bash
git add public/partials/sidebar.html
git commit -m "feat: replace sidebar partial with command dock"
```

## Task 3: Dock Shell JavaScript

**Files:**
- Modify: `public/js/sidebar.js`

- [ ] **Step 1: Update selector names and More-menu behavior**

Keep the current state object, SSE connection, `fetchSidebarState()`, `handleStateUpdate()`, `updateBadges()`, `updateTimestamp()`, and `fetchJobsCount()` behavior. Replace sidebar-specific DOM selectors and add these functions near the current navigation helpers:

```javascript
function getDockLinks() {
  return document.querySelectorAll(".dock-item, .dock-menu-item");
}

function markActive(item, active) {
  item.classList.toggle("active", active);
  if (active) {
    item.setAttribute("aria-current", item.dataset.page === "/jobs.html" ? "page" : "location");
  } else {
    item.removeAttribute("aria-current");
  }
}

function closeCommandDockMore() {
  const menu = document.getElementById("command-more-menu");
  const toggle = document.getElementById("command-more-toggle");
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

window.closeCommandDockMore = closeCommandDockMore;

window.toggleCommandDockMore = function () {
  const menu = document.getElementById("command-more-menu");
  const toggle = document.getElementById("command-more-toggle");
  if (!menu || !toggle) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
};

window.toggleSidebar = function () {
  window.toggleCommandDockMore();
};
```

- [ ] **Step 2: Replace `setActiveNavItem()` with dock-aware active logic**

Use this implementation:

```javascript
function setActiveNavItem() {
  const currentPath = window.location.pathname;
  const currentHash = window.location.hash;

  getDockLinks().forEach((item) => {
    const itemPage = item.dataset.page;
    const itemHref = item.getAttribute("href");
    let active = false;

    if (itemPage === "/" && isMainPage()) {
      if (currentHash && itemHref === currentHash) {
        active = true;
      } else if (!currentHash && item.dataset.section === "vitals") {
        active = true;
      }
    } else if (itemHref === currentPath) {
      active = true;
    }

    markActive(item, active);
  });
}
```

- [ ] **Step 3: Replace `setupNavigation()` with dock-aware navigation**

Use this implementation:

```javascript
function setupNavigation() {
  document.querySelectorAll("[data-section]").forEach((item) => {
    item.addEventListener("click", (e) => {
      const section = item.dataset.section;
      const targetHash = `#${section}-section`;

      if (isMainPage()) {
        e.preventDefault();
        const target = document.querySelector(targetHash);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          history.pushState(null, "", targetHash);
          setActiveNavItem();
          closeCommandDockMore();
        }
      } else {
        e.preventDefault();
        window.location.href = "/" + targetHash;
      }
    });
  });

  document.addEventListener("click", (event) => {
    const dock = document.getElementById("command-dock");
    if (dock && !dock.contains(event.target)) {
      closeCommandDockMore();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCommandDockMore();
  });
}
```

- [ ] **Step 4: Remove sidebar collapsed persistence**

Delete the `restoreSidebarState()` function and remove the `restoreSidebarState();` call from `init()`. The dock does not use the old collapsed state.

- [ ] **Step 5: Run shell tests**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: JS behavior-name assertions pass. CSS and page integration assertions still fail.

- [ ] **Step 6: Commit shell JavaScript**

```bash
git add public/js/sidebar.js
git commit -m "feat: adapt shell script for command dock navigation"
```

## Task 4: Shared Glass CSS System

**Files:**
- Modify: `public/css/dashboard.css`

- [ ] **Step 1: Replace root tokens and remove sidebar width token**

Replace the `:root` block at the top of `public/css/dashboard.css` with:

```css
:root {
  --bg: #071018;
  --bg-deep: #050a10;
  --glass-panel: rgba(255, 255, 255, 0.105);
  --glass-panel-strong: rgba(255, 255, 255, 0.155);
  --glass-panel-muted: rgba(255, 255, 255, 0.07);
  --glass-line: rgba(255, 255, 255, 0.16);
  --glass-line-strong: rgba(255, 255, 255, 0.24);
  --text: #eef8ff;
  --text-muted: #a7bac4;
  --text-dim: #72858f;
  --accent: #82efff;
  --accent-strong: #8ff7bb;
  --green: #8ff7bb;
  --yellow: #ffd27c;
  --red: #ff8fa7;
  --purple: #cab1ff;
  --orange: #ffb179;
  --dock-height: 82px;
  --dock-bottom: 18px;
  --content-inset: calc(var(--dock-height) + var(--dock-bottom) + 26px);
  --focus-ring: 0 0 0 3px rgba(130, 239, 255, 0.26);
}
```

- [ ] **Step 2: Add layered page and shared glass styling**

Add this block after the `body` rule:

```css
body {
  background:
    radial-gradient(circle at 15% 8%, rgba(130, 239, 255, 0.22), transparent 28%),
    radial-gradient(circle at 85% 18%, rgba(202, 177, 255, 0.18), transparent 30%),
    linear-gradient(145deg, var(--bg-deep), #101820 48%, #171821);
  overflow-x: hidden;
}

body::before {
  position: fixed;
  inset: 0;
  z-index: -2;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 72px 72px;
  content: "";
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.88), transparent 82%);
}

a,
button,
select,
input {
  -webkit-tap-highlight-color: transparent;
}

a:focus-visible,
button:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}
```

- [ ] **Step 3: Delete old `.sidebar`, `.sidebar-*`, `.nav-*`, and `.main-wrapper.sidebar-collapsed` rules**

Remove the sidebar styling block from `/* Sidebar */` through `.sidebar-footer`. Remove the `.main-wrapper.sidebar-collapsed` rule. Keep `.main-wrapper`, `header`, `.stats-bar`, `.stat`, `.section`, modal, filter, and component rules for restyling.

- [ ] **Step 4: Add dock CSS**

Insert this dock block where the old sidebar block was removed:

```css
.command-dock {
  position: fixed;
  right: 18px;
  bottom: var(--dock-bottom);
  left: 18px;
  z-index: 80;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  width: min(1120px, calc(100vw - 36px));
  min-height: var(--dock-height);
  margin: 0 auto;
  padding: 10px;
  border: 1px solid var(--glass-line-strong);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.055)),
    rgba(6, 13, 21, 0.78);
  box-shadow:
    0 22px 70px rgba(0, 0, 0, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(24px) saturate(150%);
}

.dock-brand,
.dock-item,
.dock-more-toggle,
.dock-menu-item {
  color: var(--text-muted);
  text-decoration: none;
}

.dock-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 6px 8px 6px 6px;
  border-radius: 999px;
}

.dock-brand-mark {
  display: grid;
  place-items: center;
  width: 42px;
  aspect-ratio: 1;
  border-radius: 999px;
  color: #061018;
  background: linear-gradient(135deg, var(--accent), var(--green));
  font-size: 0.78rem;
  font-weight: 900;
}

.dock-brand-text {
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}

.dock-links {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.dock-links::-webkit-scrollbar {
  display: none;
}

.dock-item,
.dock-more-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 800;
  white-space: nowrap;
}

.dock-item:hover,
.dock-more-toggle:hover,
.dock-item.active,
.dock-menu-item:hover,
.dock-menu-item.active {
  border-color: rgba(130, 239, 255, 0.28);
  color: #ffffff;
  background: rgba(255, 255, 255, 0.115);
}

.dock-item.active {
  color: #061018;
  background: linear-gradient(135deg, var(--accent), var(--green));
}

.dock-icon {
  font-size: 0.72rem;
  letter-spacing: 0;
  text-transform: uppercase;
}

.dock-badge {
  display: inline-grid;
  min-width: 22px;
  min-height: 22px;
  place-items: center;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.13);
  font-size: 0.68rem;
}

.dock-item.active .dock-badge {
  color: #061018;
  background: rgba(6, 16, 24, 0.16);
}

.dock-more {
  position: relative;
}

.command-more-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 12px);
  display: grid;
  gap: 6px;
  width: min(300px, calc(100vw - 36px));
  padding: 10px;
  border: 1px solid var(--glass-line-strong);
  border-radius: 14px;
  background: rgba(6, 13, 21, 0.92);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(24px) saturate(150%);
}

.command-more-menu[hidden] {
  display: none;
}

.dock-menu-item,
.dock-menu-readout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.82rem;
}

.dock-menu-readout {
  cursor: default;
}

.dock-menu-readout strong {
  color: var(--text);
}

.dock-sync {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 104px;
  padding: 0 10px;
  color: var(--text-dim);
  font-size: 0.72rem;
  white-space: nowrap;
}

.dock-sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 14px var(--green);
}
```

- [ ] **Step 5: Restyle shell containers**

Update `.main-wrapper`, `header`, `.stats-bar`, `.stat`, and `.section` to use zero left margin and glass surfaces:

```css
.main-wrapper {
  flex: 1;
  width: min(1540px, 100%);
  min-height: 100vh;
  margin: 0 auto;
  padding-bottom: var(--content-inset);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin: 18px 18px 0;
  padding: 16px 18px;
  border: 1px solid var(--glass-line);
  border-radius: 14px;
  background: var(--glass-panel);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
  position: sticky;
  top: 12px;
  z-index: 50;
  backdrop-filter: blur(20px) saturate(140%);
}

.stats-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 12px;
  margin: 14px 18px;
  padding: 0;
  background: transparent;
  border-bottom: 0;
  overflow: visible;
}

.stat {
  align-items: flex-start;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--glass-line);
  border-radius: 12px;
  background: var(--glass-panel);
  backdrop-filter: blur(18px) saturate(135%);
}

.section {
  margin: 0 18px 18px;
  padding: 18px;
  border: 1px solid var(--glass-line);
  border-radius: 14px;
  background: var(--glass-panel);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(18px) saturate(135%);
}
```

- [ ] **Step 6: Replace responsive sidebar rules**

Replace the old responsive block at the end of `dashboard.css` with:

```css
@media (max-width: 1024px) {
  .command-dock {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .dock-sync {
    display: none;
  }
}

@media (max-width: 768px) {
  :root {
    --dock-height: 74px;
    --dock-bottom: 10px;
    --content-inset: calc(var(--dock-height) + var(--dock-bottom) + 34px);
  }

  header {
    position: static;
    flex-direction: column;
    align-items: stretch;
    margin: 10px 10px 0;
  }

  .header-left,
  .header-actions {
    flex-wrap: wrap;
  }

  .stats-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 12px 10px;
  }

  .section {
    margin: 0 10px 12px;
    padding: 14px;
  }

  .command-dock {
    right: 10px;
    left: 10px;
    width: calc(100vw - 20px);
    min-height: var(--dock-height);
    border-radius: 18px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .dock-brand {
    display: none;
  }

  .dock-links {
    padding-bottom: 2px;
  }

  .dock-item,
  .dock-more-toggle {
    min-height: 46px;
    padding: 0 12px;
  }

  .dock-label {
    display: none;
  }

  .filters-bar,
  .section-filters {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 7: Run shell tests**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: CSS assertions pass except page integration if the pages still contain sidebar-specific markup or CSS.

- [ ] **Step 8: Commit shared CSS**

```bash
git add public/css/dashboard.css
git commit -m "feat: add glass command dock styling"
```

## Task 5: Main Dashboard Markup Integration

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Remove the old mobile sidebar button**

In the `<header>` of `public/index.html`, remove the old mobile sidebar button with `class="sidebar-toggle"` and `id="mobile-menu-btn"`. Keep the page title, language selector, and connection status.

- [ ] **Step 2: Add a shell class to the header**

Change:

```html
<header>
```

to:

```html
<header class="command-header">
```

- [ ] **Step 3: Confirm section IDs are still intact**

Verify these IDs remain present:

```text
vitals-section
llm-section
sessions-section
cron-section
memory-section
cerebro-section
operators-section
about-section
```

- [ ] **Step 4: Run shell tests**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: the dashboard page integration assertions pass.

- [ ] **Step 5: Commit dashboard markup integration**

```bash
git add public/index.html
git commit -m "feat: integrate command dock shell on dashboard"
```

## Task 6: AI Jobs Page Shared Shell Integration

**Files:**
- Modify: `public/jobs.html`

- [ ] **Step 1: Link shared dashboard CSS in `jobs.html`**

Inside `<head>`, add this before the current inline `<style>` block:

```html
<link rel="stylesheet" href="/css/dashboard.css" />
```

- [ ] **Step 2: Remove duplicated sidebar and base shell CSS from the inline style**

Delete the inline rules for:

```text
:root
*
body
.sidebar
.sidebar.collapsed
.sidebar-header
.sidebar-logo
.sidebar-title
.sidebar-toggle
.sidebar-nav
.nav-section
.nav-section-title
.nav-item
.nav-icon
.nav-badge
.sidebar-footer
.main-wrapper
.main-wrapper.sidebar-collapsed
header
.header-left
.page-title
.stats-bar
.stat
.stat-value
.stat-label
```

Keep jobs-specific rules such as:

```text
.filters-bar
.filter-btn
.jobs-grid
.job-card
.job-header
.job-action-btn
.modal-overlay
.toast-container
```

- [ ] **Step 3: Add a shell class to the jobs header**

Change:

```html
<header>
```

to:

```html
<header class="command-header jobs-command-header">
```

- [ ] **Step 4: Keep the jobs script timestamp target compatible**

Keep this behavior in `fetchJobs()`:

```javascript
document.getElementById("sidebar-updated").textContent = t(
  "sidebar.updated",
  { time: new Date().toLocaleTimeString() },
  "Updated: " + new Date().toLocaleTimeString(),
);
```

The dock partial keeps `id="sidebar-updated"` for compatibility.

- [ ] **Step 5: Run shell tests**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: all assertions in `tests/glass-dock-ui.test.js` pass.

- [ ] **Step 6: Commit jobs integration**

```bash
git add public/jobs.html public/css/dashboard.css
git commit -m "feat: share glass shell with ai jobs page"
```

## Task 7: Full Test, Lint, And Browser Verification

**Files:**
- Modify only if verification finds a defect in files touched by earlier tasks.

- [ ] **Step 1: Run the targeted test**

Run:

```bash
npm test -- tests/glass-dock-ui.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS. If unrelated tests fail because of pre-existing worktree changes, record the exact failing test names and output before proceeding.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS. If lint reports files outside this implementation scope, record the file paths and diagnostics before proceeding.

- [ ] **Step 4: Start the app for visual verification**

Run:

```bash
npm run dev
```

Expected: Vite or the configured dev server prints a local URL. If the static server is needed instead, run:

```bash
node lib/server.js --port 3333
```

- [ ] **Step 5: Verify desktop routes in the browser**

Open:

```text
http://localhost:3333/
http://localhost:3333/jobs.html
```

Check:

- The old left sidebar is gone.
- The floating dock is visible at the bottom.
- Dock links scroll to the correct dashboard sections.
- The AI Jobs link opens `/jobs.html`.
- More menu opens and closes with click and Escape.
- Privacy and cost controls still open their modals.
- SSE connection status still updates in the header.
- Content near the bottom is not hidden behind the dock.

- [ ] **Step 6: Verify mobile routes in the browser**

Use a mobile viewport near `390px` wide and check:

- Dock fits without horizontal page overflow.
- Dock labels collapse while controls remain understandable.
- More menu stays inside the viewport.
- Filters, tables, modals, and job card actions remain reachable.
- Text inside buttons and badges does not overlap.

- [ ] **Step 7: Final commit for verification fixes**

If verification required fixes, commit them:

```bash
git add public/partials/sidebar.html public/js/sidebar.js public/css/dashboard.css public/index.html public/jobs.html tests/glass-dock-ui.test.js
git commit -m "fix: polish glass dock responsive behavior"
```

If no fixes were needed, do not create an empty commit.

## Task 8: Completion Handoff

**Files:**
- No code files unless verification found a defect.

- [ ] **Step 1: Check branch status**

Run:

```bash
git status --short --branch
```

Expected: only unrelated pre-existing worktree changes remain unstaged.

- [ ] **Step 2: Summarize commits**

Run:

```bash
git log --oneline --decorate -8
```

Expected: recent commits include the design spec, implementation plan, guardrail tests, partial, shell script, CSS, dashboard integration, and jobs integration.

- [ ] **Step 3: Prepare PR summary**

Use this PR summary:

```markdown
## Summary

- Replaced the fixed left sidebar with a shared floating glass command dock.
- Added a shared glassmorphism visual system for the static dashboard UI.
- Integrated the shell with the main dashboard and AI Jobs page while preserving existing API/SSE behavior.
- Added static tests for the dock partial, CSS shell, and page integration.

## Verification

- npm test
- npm run lint
- Browser check: `/` desktop and mobile
- Browser check: `/jobs.html` desktop and mobile
```

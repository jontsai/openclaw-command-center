# Floating Glass Dock Redesign Design

Date: 2026-06-01
Status: Approved for implementation planning

## Summary

Redesign the existing `public/` dashboard UI with a glassmorphism visual system and replace the
left sidebar with a modern floating bottom dock. The work applies to the current static UI pages:
`public/index.html`, `public/jobs.html`, `public/partials/sidebar.html`, `public/js/sidebar.js`,
and `public/css/dashboard.css`.

The redesign must preserve current dashboard behavior: existing API endpoints, SSE updates,
section anchors, filters, modals, internationalization, privacy controls, and AI Jobs actions remain
in place. This is a visual and shell/navigation redesign, not a backend or API redesign.

## Goals

- Convert the existing UI to a coherent glassmorphism design.
- Remove the old fixed left sidebar from the active experience.
- Replace sidebar navigation with a bottom floating glass dock.
- Keep dense operational dashboards readable and efficient.
- Share the shell and component styling between the main dashboard and AI Jobs page.
- Avoid touching unrelated React/Vite work currently present in the worktree.

## Non-Goals

- Do not migrate the existing `public/` UI to React or Vite as part of this redesign.
- Do not change server API contracts or SSE event formats.
- Do not add new runtime dependencies.
- Do not modify authentication, secrets, or `config/` files.
- Do not remove existing dashboard sections or job management capabilities.

## Chosen Direction

The selected direction is the **Floating Glass Dock**.

The dock sits at the bottom center of the viewport on desktop and replaces the old sidebar as the
primary navigation surface. It contains direct destinations for high-frequency dashboard sections
and a compact "More" menu for lower-frequency destinations. It preserves page anchors and route
links so existing navigation behavior remains straightforward.

The visual style uses translucent dark glass surfaces, high-contrast text, restrained cyan/green/
violet/amber accents, crisp borders, visible focus states, and small-radius panels. The result should
feel like a modern command cockpit while staying usable for repeated operational monitoring.

## Information Architecture

### Main Dashboard

The main dashboard keeps these sections and anchors:

- System Vitals: `#vitals-section`
- LLM Usage: `#llm-section`
- Sessions: `#sessions-section`
- Cron Jobs: `#cron-section`
- Memory: `#memory-section`
- Cerebro: `#cerebro-section`
- Operators: `#operators-section`
- About: `#about-section`

The top of the page becomes a compact command header with:

- OpenClaw Command Center identity.
- SSE connection status.
- Last sync status.
- Language selector.
- Privacy control.

The dashboard body becomes:

- An Overmind summary panel for system-level status.
- A KPI strip for tokens, active sessions, cost, and capacity.
- Glass panels for each existing section.
- Section-local filters and actions kept near the content they affect.

### AI Jobs Page

The AI Jobs page uses the same shell and dock, with content adapted to jobs:

- Page header for AI Jobs.
- Job summary stats.
- Job cards and status controls.
- Run, pause/resume, and history interactions.

The dock should include an AI Jobs route link and reflect the active page.

## Navigation Design

Replace the old sidebar partial with a shared dock-oriented shell partial. The implementation can
either rename the partial or keep the `sidebar.html` path as a compatibility layer, but the visible
component should no longer be a fixed left rail.

Dock destinations:

- Vitals
- LLM
- Sessions
- Cron
- Memory
- AI Jobs
- More

The More menu contains:

- Cerebro
- Operators
- Privacy
- About

The dock should:

- Use real anchors or links.
- Show active section or page state.
- Preserve smooth scrolling on the main dashboard.
- Navigate from `jobs.html` back to main dashboard anchors when needed.
- Maintain live badges for sections that already expose sidebar badge data.
- Leave enough bottom content padding so it never covers final rows, filters, buttons, or modal
  triggers.

## Responsive Behavior

Desktop:

- Dock floats bottom center with a max width and glass background.
- Main content uses full width that was previously lost to the sidebar.
- Header remains sticky or near-sticky enough for connection and sync awareness.

Tablet:

- Dock remains bottom aligned, can horizontally scroll if space is tight.
- Labels may shorten, but controls must remain understandable.

Mobile:

- Dock becomes compact and touch-friendly.
- Less-used destinations move behind More.
- Content receives extra bottom padding.
- Tables and filter rows must not be obscured by the dock.

## Component Styling

Global visual tokens should live in `public/css/dashboard.css`:

- Dark layered page background.
- Glass panel background colors.
- Glass borders.
- Accent colors.
- Text colors.
- Focus ring.
- Shadow and blur tokens.
- Dock height and content bottom inset.

Cards and panels:

- Use 8px to 14px border radii.
- Avoid nested card-in-card layouts.
- Keep table-heavy panels dense and scannable.
- Use clear panel headings and compact stat cards.
- Keep text from overflowing buttons, badges, and cards.

Controls:

- Buttons, filters, selects, and modals inherit the glass system.
- Primary actions use accent fills.
- Secondary actions use translucent surfaces.
- Danger/error states remain clearly red and accessible.

## Behavior Preservation

The redesign must preserve:

- `/api/state` data loading.
- `/api/events` SSE updates.
- Sidebar badge equivalent updates.
- `openCostModal()`.
- `openPrivacyModal()`.
- Existing filters and sort controls.
- Existing session, cron, memory, Cerebro, operator, and jobs render/update logic.
- Existing i18n attributes and language selector behavior.

Compatibility wrappers may remain for existing global functions such as `toggleSidebar()` if doing
so reduces implementation risk.

## Accessibility

- Dock controls must be keyboard reachable.
- Active destinations should expose `aria-current`.
- Icon-only or shortened controls need accessible labels.
- Focus states must be visible on glass surfaces.
- Text contrast must stay readable against translucent backgrounds.
- Motion and glow should be restrained and not required for comprehension.

## Testing And Verification

Run:

- `npm test`
- `npm run lint`

Manual browser verification:

- `/` desktop width.
- `/jobs.html` desktop width.
- `/` mobile width.
- `/jobs.html` mobile width.

Check:

- Dock links scroll or route correctly.
- Active destination updates.
- SSE connection status still updates.
- Section badges still update.
- Privacy and cost modals still open.
- Filters and action buttons remain reachable.
- Content is not hidden behind the dock.
- Text does not overlap or overflow on mobile.

## Implementation Notes

The repository currently has unrelated uncommitted React/Vite work on `main`. Implementation should
avoid touching or reverting that work unless the owner explicitly asks for it. The redesign scope is
the existing static `public/` UI.

All implementation changes must happen on a feature branch and go through a pull request. Do not
push directly to `main`.

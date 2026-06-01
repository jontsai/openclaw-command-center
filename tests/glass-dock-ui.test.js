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

  it("keeps dock controls accessible when mobile labels are hidden", () => {
    assert.match(dashboardCss, /\.dock-label\s*{\s*display:\s*none;/);

    const dockControls =
      partial.match(/<(?:a|button)[^>]*class="[^"]*\bdock-item\b[^"]*"[^>]*>/g) || [];

    assert.ok(dockControls.length >= 7);
    for (const control of dockControls) {
      assert.match(control, /\baria-label="/);
    }

    assert.match(partial, /aria-label="System Vitals"/);
    assert.match(partial, /aria-label="LLM Usage"/);
    assert.match(partial, /aria-label="Sessions"/);
    assert.match(partial, /aria-label="Cron Jobs"/);
    assert.match(partial, /aria-label="Memory"/);
    assert.match(partial, /aria-label="AI Jobs Dashboard"/);
    assert.match(partial, /aria-label="More commands"/);
  });

  it("defines the shared glass visual system and bottom dock layout", () => {
    assert.match(dashboardCss, /--glass-panel:/);
    assert.match(dashboardCss, /--dock-height:/);
    assert.match(dashboardCss, /backdrop-filter: blur/);
    assert.match(dashboardCss, /\.command-dock/);
    assert.match(dashboardCss, /\.command-more-menu/);
    assert.match(dashboardCss, /\.main-wrapper\s*{[^}]*margin:\s*0 auto/s);
    assert.doesNotMatch(dashboardCss, /--sidebar-width/);
  });

  it("integrates the shared shell on dashboard and jobs pages", () => {
    assert.match(indexHtml, /id="sidebar-container"/);
    assert.match(jobsHtml, /id="sidebar-container"/);
    assert.match(indexHtml, /<script src="js\/sidebar\.js"><\/script>/);
    assert.match(jobsHtml, /<script src="\/js\/sidebar\.js"><\/script>/);
    assert.doesNotMatch(indexHtml, /id="mobile-menu-btn"/);
    assert.doesNotMatch(indexHtml, /sidebarCollapsed/);
    assert.doesNotMatch(indexHtml, /\.nav-item\[data-section\]/);
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

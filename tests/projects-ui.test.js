const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.value = "";
    this._text = "";
    const classes = new Set();
    this.classList = {
      toggle: (name) => {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      },
      contains: (name) => classes.has(name),
    };
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  set innerHTML(_value) {
    throw new Error("Imported project data must not become HTML");
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this._text = "";
    this.children = children;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(key, listener) {
    this.events[key] = listener;
  }
}
function descendants(root, predicate) {
  return [root, ...root.children.flatMap((child) => descendants(child, () => true))].filter(
    predicate,
  );
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function setup(data, clock = null) {
  const ids = [
    "board",
    "message",
    "sources",
    "refresh",
    "source",
    "health",
    "agent",
    "search",
    "filters",
    "menu",
  ];
  const elements = Object.fromEntries(ids.map((id) => [`projects-${id}`, new Element("div")]));
  elements.sidebar = new Element("aside");
  const events = {};
  const requests = [];
  let reply = () => Promise.resolve({ ok: true, json: async () => data });
  let locale = "en";
  const window = {
    addEventListener: (key, callback) => {
      events[key] = callback;
    },
    I18N: {
      getLocale: () => locale,
      t: (key, params, fallback) => {
        const translated =
          locale === "zh-CN"
            ? {
                "projectBoard.stage.doing": "进行中",
                "projectBoard.sourceState.stale": "过期",
                "projectBoard.owner": "负责人",
              }[key]
            : null;
        return (translated || fallback).replace(/\{(\w+)\}/g, (_, name) => params[name]);
      },
    },
  };
  const document = {
    readyState: "complete",
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/projects.js"), "utf8"), {
    window,
    document,
    URL,
    Date: clock
      ? class extends Date {
          static now() {
            return clock.now;
          }
        }
      : Date,
    AbortController: globalThis.AbortController,
    setTimeout: clock ? clock.setTimeout : setTimeout,
    clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    fetch: (url, options) => {
      requests.push({ url, options });
      return reply();
    },
  });
  return {
    window,
    elements,
    requests,
    reply: (next) => {
      reply = next;
    },
    locale: (next) => {
      locale = next;
      events["i18n:updated"]();
    },
    filter: (key, value) => {
      elements[`projects-${key}`].value = value;
      elements[`projects-${key}`].events[key === "search" ? "input" : "change"]({
        target: { value },
      });
    },
  };
}
function project(overrides = {}) {
  return {
    id: "same-id",
    title: "Same title",
    url: "https://example.com/project",
    kind: "project",
    stage: "doing",
    nativeStatus: "In flight",
    health: "on-track",
    owner: null,
    summary: "Outcome",
    counts: { total: null, done: null, blocked: null },
    agents: ["worker"],
    sessionKeys: [],
    dependencies: [],
    ...overrides,
  };
}
function source(id, projects, status = "ready") {
  return {
    id,
    label: id,
    provider: id.startsWith("jira") ? "jira" : "linear",
    status,
    observedAt: "2026-01-01T00:00:00Z",
    projects,
  };
}
function state(sources) {
  return { schemaVersion: 1, status: "ready", sources };
}

test("portfolio preserves composite identities, native statuses and unknown task counts", async () => {
  const ui = setup(
    state([
      source("linear-a", [project()]),
      source("jira-b", [project({ kind: "epic", stage: "review", nativeStatus: "Ready for QA" })]),
    ]),
  );
  await settle();
  const cards = descendants(ui.elements["projects-board"], (el) => el.className === "project-card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.sourceId, "linear-a");
  assert.equal(cards[1].dataset.sourceId, "jira-b");
  assert.match(ui.elements["projects-board"].textContent, /Ready for QA/);
  assert.match(ui.elements["projects-board"].textContent, /\? done \/ \? total/);
  assert.match(ui.elements["projects-board"].textContent, /not a project completion estimate/);
  assert.notEqual(
    ui.window.ProjectBoard.identity("a/b", "c"),
    ui.window.ProjectBoard.identity("a", "b/c"),
  );
});

test("source, health, agent and search filters operate locally without extra requests", async () => {
  const ui = setup(
    state([
      source("linear-a", [project()]),
      source("jira-b", [
        project({ health: "blocked", agents: ["reviewer"], title: "Another outcome" }),
      ]),
    ]),
  );
  await settle();
  const cards = () =>
    descendants(ui.elements["projects-board"], (el) => el.className === "project-card");
  ui.filter("source", "jira-b");
  assert.equal(cards().length, 1);
  ui.filter("health", "on-track");
  assert.equal(cards().length, 0);
  assert.match(ui.elements["projects-message"].textContent, /No projects match/);
  ui.filter("source", "");
  ui.filter("health", "");
  ui.filter("agent", "worker");
  assert.equal(cards().length, 1);
  ui.filter("search", "ANOTHER");
  assert.equal(cards().length, 0);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].url, "api/projects");
  for (const base of [
    "https://example.com/projects.html",
    "https://example.com/molty/projects.html",
  ]) {
    assert.equal(
      new URL(ui.requests[0].url, base).pathname,
      base.includes("molty") ? "/molty/api/projects" : "/api/projects",
    );
  }
});

test("renders imported HTML as skipped raw text, rejects unsafe links, and resolves dependencies only by IDs", async () => {
  const attack = '<img src=x onerror="alert(1)">';
  const ui = setup(
    state([
      source("linear-a", [
        project({
          title: attack,
          url: "javascript:alert(1)",
          dependencies: [
            { sourceId: "jira-b", projectId: "same-id" },
            { sourceId: "missing", projectId: "same-id" },
          ],
        }),
      ]),
      source("jira-b", [project({ title: "Linked outcome" })]),
    ]),
  );
  await settle();
  const root = ui.elements["projects-board"];
  assert.match(root.textContent, /<img src=x onerror=/);
  assert.equal(descendants(root, (el) => el.tag === "img").length, 0);
  assert.equal(descendants(root, (el) => el.tag === "h3")[0].dataset.i18nSkip, "true");
  assert.equal(descendants(root, (el) => el.tag === "a").length, 1);
  assert.match(root.textContent, /jira-b \/ Linked outcome/);
  assert.match(root.textContent, /missing \/ same-id — Not in this snapshot/);
  assert.equal(ui.window.ProjectBoard.safeUrl("https://user:secret@example.com"), null);
  assert.equal(ui.window.ProjectBoard.safeUrl("http://example.com"), null);
});

test("refresh is coalesced and failures retain data explicitly marked stale; language switching preserves raw values", async () => {
  const ui = setup(state([source("linear-a", [project({ owner: "Owner", title: "Doing" })])]));
  await settle();
  let reject;
  ui.reply(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = ui.window.ProjectBoard.refresh();
  await ui.window.ProjectBoard.refresh();
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.elements["projects-refresh"].disabled, true);
  reject(new Error("private transport diagnostic"));
  await pending;
  assert.match(ui.elements["projects-message"].textContent, /previous snapshots/);
  assert.match(ui.elements["projects-board"].textContent, /Source data: Stale/);
  assert.doesNotMatch(ui.elements["projects-message"].textContent, /private/);
  ui.locale("zh-CN");
  assert.match(ui.elements["projects-board"].textContent, /进行中/);
  const title = descendants(ui.elements["projects-board"], (el) => el.tag === "h3")[0];
  assert.equal(title.textContent, "Doing");
  assert.equal(title.dataset.i18nSkip, "true");
  ui.locale("en");
  assert.doesNotMatch(ui.elements["projects-board"].textContent, /进行中/);
});

test("no-source, empty and failed responses have distinct states and no new streaming transport", async () => {
  const ui = setup(state([]));
  await settle();
  assert.match(ui.elements["projects-message"].textContent, /No project sources configured/);
  ui.reply(async () => ({ ok: true, json: async () => state([source("linear-a", [])]) }));
  await ui.window.ProjectBoard.refresh();
  assert.match(ui.elements["projects-message"].textContent, /No projects reported/);
  const failure = setup(null);
  await settle();
  assert.match(failure.elements["projects-message"].textContent, /could not be loaded/);
  const script = fs.readFileSync(path.join(__dirname, "../public/js/projects.js"), "utf8");
  assert.doesNotMatch(script, /new EventSource|setInterval|innerHTML/);
  const html = fs.readFileSync(path.join(__dirname, "../public/projects.html"), "utf8");
  assert.match(html, /js\/state-stream\.js/);
  assert.match(html, /Read-only snapshots/);
  assert.match(html, /data-i18n="projectBoard.title"/);
});

test("failed refresh marks retained empty snapshots stale without changing observation times or hiding partial coverage", async () => {
  const ui = setup(
    state([
      source("linear-ready", [], "ready"),
      source("linear-partial", [], "partial"),
      source("linear-stale", [], "stale"),
      source("linear-disabled", [], "disabled"),
    ]),
  );
  await settle();
  const root = ui.elements["projects-sources"];
  const observed = () =>
    descendants(
      root,
      (el) => el.tag === "p" && el.textContent.startsWith("Snapshot observed:"),
    ).map((el) => el.textContent);
  const originalTimes = observed();
  ui.reply(async () => ({ ok: false }));
  await ui.window.ProjectBoard.refresh();
  assert.equal(descendants(root, (el) => el.dataset.status === "ready").length, 0);
  assert.equal(descendants(root, (el) => el.dataset.status === "stale").length, 3);
  assert.equal(descendants(root, (el) => el.dataset.status === "partial").length, 1);
  assert.equal(descendants(root, (el) => el.dataset.status === "disabled").length, 1);
  assert.deepEqual(observed(), originalTimes);
  assert.match(ui.elements["projects-message"].textContent, /previous snapshots/);
});

test("zero-source configuration error is not described as unconfigured", async () => {
  const ui = setup({ schemaVersion: 1, status: "error", sources: [] });
  await settle();
  assert.match(ui.elements["projects-message"].textContent, /could not be loaded/);
  assert.doesNotMatch(ui.elements["projects-message"].textContent, /No project sources configured/);
});

test("one local deadline ages source freshness without network refresh and distinguishes same-label sources", async () => {
  const timers = new Map();
  let nextTimer = 0;
  const observedAt = "2026-01-01T00:00:00Z";
  const clock = {
    now: Date.parse(observedAt) + 4 * 60 * 1000,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const ui = setup(
    state([
      { ...source("linear-first", [], "ready"), label: "Shared", observedAt },
      { ...source("linear-second", [], "partial"), label: "Shared", observedAt },
    ]),
    clock,
  );
  await settle();
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 60000);
  assert.match(ui.elements["projects-sources"].textContent, /linear-first/);
  assert.match(ui.elements["projects-source"].textContent, /linear-second/);
  clock.now += 60000;
  timer.callback();
  assert.equal(timers.size, 0);
  assert.equal(ui.requests.length, 1);
  assert.equal(
    descendants(ui.elements["projects-sources"], (el) => el.dataset.status === "stale").length,
    2,
  );
  assert.equal(
    descendants(ui.elements["projects-sources"], (el) => el.dataset.status === "partial").length,
    1,
  );
});

test("shared i18n can create its language control and mobile menu uses the shared visible class", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/projects.html"), "utf8");
  // Shared i18n creates both container and select only when container is absent.
  assert.doesNotMatch(html, /id="lang-switcher"/);
  assert.match(html, /src="js\/i18n\.js"/);
  const css = fs.readFileSync(path.join(__dirname, "../public/css/dashboard.css"), "utf8");
  assert.match(css, /\.sidebar\.visible\s*\{\s*transform:\s*translateX\(0\)/);
  const ui = setup(state([]));
  await settle();
  ui.elements["projects-menu"].events.click();
  assert.equal(ui.elements.sidebar.classList.contains("visible"), true);
  assert.equal(ui.elements["projects-menu"].attributes["aria-expanded"], "true");
  ui.elements["projects-menu"].events.click();
  assert.equal(ui.elements.sidebar.classList.contains("visible"), false);
  assert.equal(ui.elements["projects-menu"].attributes["aria-expanded"], "false");
});

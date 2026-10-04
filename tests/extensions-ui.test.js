const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Minimal DOM exercises text-node construction without browser dependencies.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.value = "";
  }
  set textContent(value) {
    this.value = String(value);
    this.children = [];
  }
  get textContent() {
    return this.value + this.children.map((child) => child.textContent).join("");
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.value = "";
    this.children = children;
  }
  set innerHTML(_value) {
    throw new Error("Extension data must never be interpreted as HTML");
  }
}
function setup() {
  const root = new Element("div");
  const legacy = [new Element("section"), new Element("section"), new Element("section")];
  let locale = "en";
  const events = {};
  const dictionary = Object.fromEntries(
    ["en", "zh-CN"].map((lang) => [
      lang,
      JSON.parse(fs.readFileSync(path.join(__dirname, `../public/locales/${lang}.json`), "utf8")),
    ]),
  );
  const window = {
    I18N: {
      getLocale: () => locale,
      t: (key, _params, fallback) =>
        key.split(".").reduce((obj, part) => obj?.[part], dictionary[locale]) ?? fallback,
    },
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
  };
  const document = {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element("fragment"),
    querySelectorAll: () => legacy,
    getElementById: (id) => (id === "extension-content" ? root : null),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/extensions.js"), "utf8"), {
    window,
    document,
  });
  return {
    root,
    legacy,
    render: window.ExtensionPanels.render,
    locale: (lang) => {
      locale = lang;
      events["i18n:updated"]();
    },
  };
}
const title = { en: "Business results", "zh-CN": "业务数据" };
function item(status = "ready") {
  return {
    id: "spacesuit.example",
    status,
    observedAt: "2026-01-01T00:00:00Z",
    panels: [
      {
        id: "totals",
        type: "metrics",
        title,
        metrics: [{ label: { en: "Total", "zh-CN": "总数" }, value: 0 }],
      },
      {
        id: "records",
        type: "table",
        title,
        columns: [{ key: "name", label: { en: "Name", "zh-CN": "名称" } }],
        rows: [{ name: '<img src=x onerror="alert(1)">' }],
      },
    ],
  };
}
test("core-only render hides legacy panels and describes standalone monitoring", () => {
  const ui = setup();
  ui.render({ mode: "core", items: [] });
  assert.ok(ui.legacy.every((el) => el.hidden));
  assert.match(ui.root.textContent, /Core monitoring only/);
  assert.match(ui.root.textContent, /highly recommended companion/);
  ui.render({ mode: "legacy", items: [] });
  assert.ok(ui.legacy.every((el) => !el.hidden));
});
test("structured labels switch languages without interpreting data as HTML", () => {
  const ui = setup();
  ui.render({ mode: "extensions", items: [item()] });
  assert.match(ui.root.textContent, /Business results/);
  assert.match(ui.root.textContent, /<img src=x onerror=/);
  assert.match(ui.root.textContent, /Total0/);
  ui.locale("zh-CN");
  assert.match(ui.root.textContent, /业务数据/);
  assert.match(ui.root.textContent, /总数0/);
  assert.doesNotMatch(ui.root.textContent, /Business results/);
  ui.locale("en");
  assert.match(ui.root.textContent, /Business results/);
});
test("unavailable/error states never present panel values as current", () => {
  const ui = setup();
  for (const status of ["unavailable", "error", "disabled", "loading", "malicious"]) {
    ui.render({ mode: "extensions", items: [item(status)] });
    assert.doesNotMatch(ui.root.textContent, /Business results|Total0/);
    assert.match(ui.root.textContent, /Core monitoring is unaffected/);
  }
  ui.render({ mode: "extensions", items: [item("stale")] });
  assert.match(ui.root.textContent, /values below are not current/);
  assert.match(ui.root.textContent, /Business results/);
});
test("invalid selection diagnostics are generic and do not echo host data", () => {
  const ui = setup();
  ui.render({ mode: "core", diagnostic: "/private/workspace/secret", items: [] });
  assert.match(ui.root.textContent, /selection could not be loaded/);
  assert.doesNotMatch(ui.root.textContent, /private|secret/);
});

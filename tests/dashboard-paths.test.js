const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const detailFn = html.slice(
  html.indexOf("async function fetchSessionDetail("),
  html.indexOf("function renderDetailError("),
);
for (const base of ["http://example.local/", "http://example.local/fleet/agent/"]) {
  test(`session detail stays inside its dashboard at ${base}`, async () => {
    let requested, rendered, error;
    const key = "agent:main:chat:channel:test:thread:123?x=1#part";
    const data = { key, transcriptAvailable: false, tokens: 123 };
    const context = {
      AbortController: globalThis.AbortController,
      setTimeout,
      clearTimeout,
      console,
      fetch: async (input) => {
        requested = new URL(input, base);
        return { ok: true, json: async () => data };
      },
      renderDetail: (value) => {
        rendered = value;
      },
      renderDetailError: (value) => {
        error = value;
      },
    };
    vm.createContext(context);
    vm.runInContext(detailFn, context);
    await context.fetchSessionDetail(key);
    assert.equal(requested.pathname, new URL("api/session", base).pathname);
    assert.equal(requested.searchParams.get("key"), key);
    assert.equal(requested.hash, "");
    assert.equal(rendered, data);
    assert.equal(error, undefined);
  });
}
test("transcript-unavailable detail preserves overview but avoids false empty claims", () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "" });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element },
    smartUpdate: (el, html) => {
      el.innerHTML = html;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    html.slice(html.indexOf("function renderDetail(data)"), html.indexOf("// Keyboard shortcuts")),
    context,
  );
  context.renderDetail({
    transcriptAvailable: false,
    channel: "Example",
    tokens: 123,
    summary: "Transcript unavailable — session metadata only.",
  });
  assert.match(element("detail-overview").innerHTML, /123/);
  for (const id of ["links", "attention", "facts", "tools", "messages"])
    assert.match(element(`detail-${id}`).innerHTML, /Transcript unavailable/);
});

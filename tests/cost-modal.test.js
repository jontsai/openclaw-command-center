const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
function harness(fetch) {
  const elements = new Map();
  const context = {
    AbortController: globalThis.AbortController,
    setTimeout,
    clearTimeout,
    fetch,
    escapeHtml: String,
    document: {
      getElementById(id) {
        if (!elements.has(id))
          elements.set(id, { innerHTML: "", classList: { add() {}, remove() {} } });
        return elements.get(id);
      },
    },
    renderCostBreakdown(data) {
      context.rendered = data;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    html.slice(html.indexOf("let cachedCostData"), html.indexOf("// Auth fix modal")),
    context,
  );
  return { context, elements };
}
test("cost modal fills every section while loading and after HTTP failure", async () => {
  let release;
  const h = harness(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = h.context.openCostModal();
  for (const [id, el] of h.elements)
    if (id.startsWith("cost-") && !id.includes("modal")) assert.match(el.innerHTML, /Loading/);
  release({ ok: false, status: 500 });
  await pending;
  for (const [id, el] of h.elements)
    if (id.startsWith("cost-") && !id.includes("modal")) assert.match(el.innerHTML, /unavailable/);
});
test("late response cannot overwrite a newer cost request", async () => {
  const requests = [];
  const h = harness((url, opts) => new Promise((resolve) => requests.push({ url, opts, resolve })));
  const a = h.context.openCostModal(),
    b = h.context.openCostModal();
  assert.equal(requests[0].opts.signal.aborted, true);
  assert.equal(requests[1].url, "api/cost-breakdown");
  requests[1].resolve({ ok: true, json: async () => ({ id: 2 }) });
  await b;
  requests[0].resolve({ ok: true, json: async () => ({ id: 1 }) });
  await a;
  assert.equal(h.context.rendered.id, 2);
});

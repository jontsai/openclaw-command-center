const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformLiveUsageData } = require("../src/llm-usage");
function renderer() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, { textContent: "", innerHTML: "", style: {}, className: "" });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element },
    console,
    $set: (id, key, value) => {
      const el = element(id);
      if (key.startsWith("style.")) el.style[key.slice(6)] = value;
      else el[key] = value;
    },
    escapeHtml: (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      ),
  };
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  vm.createContext(context);
  vm.runInContext(
    html.slice(
      html.indexOf("function renderCodexUsage("),
      html.indexOf("async function fetchRoutingStats("),
    ),
    context,
  );
  return { context, element };
}
test("full renderer displays OpenAI usage even when Claude fails", () => {
  const { context, element } = renderer();
  const data = transformLiveUsageData({
    providers: [
      { provider: "anthropic", error: "HTTP 429" },
      { provider: "openai", plan: "pro", windows: [{ label: "Week", usedPercent: 28 }] },
    ],
  });
  context.renderLlmUsage(data);
  assert.match(element("codex-windows").innerHTML, /Week usage/);
  assert.match(element("codex-windows").innerHTML, /28% used/);
  assert.equal(element("codex-plan").textContent, "pro");
  assert.doesNotMatch(element("claude-session-reset").innerHTML, /openAuthModal/);
});
test("missing quota never renders zero; valid zero does", () => {
  const { context, element } = renderer();
  context.renderLlmUsage(null);
  assert.match(element("codex-windows").innerHTML, /N\/A/);
  assert.doesNotMatch(element("codex-windows").innerHTML, /0% used/);
  context.renderCodexUsage({ status: "available", windows: [{ label: "5h", usedPercent: 0 }] });
  assert.match(element("codex-windows").innerHTML, /0% used/);
});
test("stale windows and malicious labels remain unavailable and escaped", () => {
  const { context, element } = renderer();
  context.renderCodexUsage({
    status: "stale",
    windows: [{ label: '<img src=x onerror="alert(1)">', usedPercent: 40 }],
  });
  const html = element("codex-windows").innerHTML;
  assert.match(html, /N\/A/);
  assert.doesNotMatch(html, /40% used/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(element("codex-status").textContent, /Stale/);
});

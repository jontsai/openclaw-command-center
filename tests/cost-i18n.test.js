const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const locales = ["en", "zh-CN"].map((name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `../public/locales/${name}.json`), "utf8")),
);
test("cost and token labels retain localization hooks beside runtime values", () => {
  for (const key of [
    "stats.totalTokens",
    "stats.estApiCost",
    "cost.title",
    "cost.tokenUsage",
    "cost.pricingBasis",
    "cost.calculation",
    "cost.billing",
    "cost.sessions",
  ]) {
    assert.ok(html.includes(`data-i18n="${key}"`), `Missing localization hook: ${key}`);
    for (const locale of locales) {
      const value = key.split(".").reduce((obj, part) => obj?.[part], locale);
      assert.equal(typeof value, "string", `Missing locale value: ${key}`);
    }
  }
  for (const id of [
    "token-period-label",
    "cost-period-label",
    "cost-provisional-label",
    "cost-modal-title",
  ]) {
    const runtime = html.match(new RegExp(`<span id="${id}">([^<]*)</span>`));
    assert.ok(
      runtime,
      `${id} must remain a separate runtime span, not replace the translated label`,
    );
  }
});
test("new loading, failure and accounting notices have phrase translations", () => {
  const exact = locales[1].phrases.exact;
  for (const text of [
    "Today (UTC)",
    "Loading cost data…",
    "Cost request timed out. Close and reopen to retry.",
    "Cost data unavailable. Close and reopen to retry.",
    "Provisional snapshot — OpenClaw is refreshing its usage records.",
    "Some usage has no recorded price; total cost is unavailable.",
    "Recorded per-model API-equivalent costs from OpenClaw; not subscription charges.",
    "Recent messages only; metadata totals cover the session.",
  ]) {
    assert.equal(typeof exact[text], "string", `Missing dynamic translation: ${text}`);
    assert.notEqual(exact[text], text);
  }
});

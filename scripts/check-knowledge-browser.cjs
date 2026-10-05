// Optional browser check against scripts/preview-knowledge.js. Not part of npm test.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = process.env.KNOWLEDGE_PREVIEW_URL || "http://127.0.0.1:18340";
    await page.goto(`${base}/preview/knowledge.html`, { waitUntil: "domcontentloaded" });
    await page.locator(".knowledge-document").first().waitFor();
    assert.equal(await page.locator(".knowledge-source").count(), 3);
    assert.equal(await page.locator(".knowledge-document").count(), 8);
    await page.locator("#knowledge-tree > details").nth(1).locator(":scope > button").click();
    assert.equal(await page.locator(".knowledge-document").count(), 4);
    await page.locator("#knowledge-tree > button").click();
    await page.locator(".knowledge-document").filter({ hasText: "Small batches" }).click();
    await page.locator("#knowledge-reader h3").filter({ hasText: "Small batches" }).waitFor();
    assert.match(await page.locator("#knowledge-reader").innerText(), /memory\/decisions/);
    await page.locator("#knowledge-tree > details").nth(2).locator(":scope > button").click();
    assert.equal(await page.locator(".knowledge-document").count(), 2);
    await page.locator(".knowledge-document").filter({ hasText: "Protect the planning" }).click();
    assert.match(
      await page.locator("#knowledge-reader").innerText(),
      /qmd:\/\/notes\/strategy\/protected-planning.md/,
    );
    assert.equal(await page.locator('#knowledge-reader a[href^="qmd:"]').count(), 0);
    assert.match(await page.locator("#knowledge-reader").innerText(), /Unknown/);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(() => window.scrollY === 0);
    if (process.env.KNOWLEDGE_SCREENSHOT)
      await page.screenshot({ path: process.env.KNOWLEDGE_SCREENSHOT, fullPage: true });
    await page.locator("#knowledge-tree > button").click();
    await page.locator("#knowledge-search").fill("fresh page");
    assert.equal(await page.locator(".knowledge-document").count(), 1);
    await page.locator("#knowledge-search").fill("");
    await page.locator("#lang-select").selectOption("zh-CN");
    await page.getByRole("heading", { name: "知识浏览器", exact: true }).waitFor();
    assert.equal(
      await page.locator(".knowledge-document strong").filter({ hasText: "Small batches" }).count(),
      1,
    );
    await page.locator("#lang-select").selectOption("en");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.goto(`${base}/knowledge.html`);
    await page.locator(".knowledge-document").first().waitFor();
    // Provider content stays text, even in source preview.
    await page.route("**/api/knowledge", async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      body.sources[0].documents.find((d) => d.kind === "document").excerpt =
        '<img src=x onerror="window.injected=true">';
      await route.fulfill({ json: body });
    });
    await page.locator("#knowledge-refresh").click();
    await page.locator(".knowledge-document").filter({ hasText: "<img" }).waitFor();
    await page.locator(".knowledge-document").filter({ hasText: "<img" }).click();
    assert.equal(await page.locator("#knowledge-reader img").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.unroute("**/api/knowledge");
    await page.route("**/api/knowledge", (route) => route.abort());
    await page.locator("#knowledge-refresh").click();
    await page.locator("#knowledge-message").filter({ hasText: "Reload failed" }).waitFor();
    assert.equal(await page.locator(".knowledge-document").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "Knowledge browser checks passed: root/prefix, desktop/mobile, filters, preview, i18n, safe text.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { estimate } = require("../public/js/cost-scenario");
test("scenario uses selected calendar window and explicit baseline, not a guessed plan", () => {
  const windows = { "7d": { totalCost: 70 }, "3d": { totalCost: 60 } };
  assert.equal(estimate(windows, "7dma", 200).difference, 100);
  assert.equal(estimate(windows, "3dma", 200).difference, 400);
  for (const value of [null, undefined, "200", NaN, -1])
    assert.equal(estimate(windows, "7dma", value), null);
  assert.equal(estimate(windows, "unknown", 0), null);
});
test("partial, missing, zero and negative savings remain distinct", () => {
  const partial = estimate({ "7d": { totalCost: null, recordedCost: 0 } }, "7dma", 200);
  assert.equal(partial.partial, true);
  assert.equal(partial.difference, -200);
  assert.equal(estimate({ "7d": { totalCost: null, recordedCost: null } }, "7dma", 0), null);
  assert.equal(estimate({ "7d": { totalCost: 0 } }, "7dma", 0).difference, 0);
  assert.equal(estimate({ "7d": { totalCost: 0 } }, "7dma", 0).partial, false);
});

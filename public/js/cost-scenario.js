// Explicit what-if projection; never a measured bill or inferred plan price.
(function (root) {
  function estimate(windows, key, baseline) {
    const days = { "24h": 1, "3dma": 3, "7dma": 7 }[key];
    if (!days || typeof baseline !== "number" || !Number.isFinite(baseline) || baseline < 0)
      return null;
    const bucket = windows?.[{ "24h": "24h", "3dma": "3d", "7dma": "7d" }[key]];
    const cost = Number.isFinite(bucket?.totalCost) ? bucket.totalCost : bucket?.recordedCost;
    if (!Number.isFinite(cost) || cost < 0) return null;
    const projected = (cost / days) * 30;
    return {
      projected,
      baseline,
      difference: projected - baseline,
      partial: !Number.isFinite(bucket.totalCost),
      days,
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { estimate };
  else root.CostScenario = { estimate };
})(typeof globalThis === "object" ? globalThis : this);

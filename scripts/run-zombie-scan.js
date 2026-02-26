#!/usr/bin/env node
/**
 * run-zombie-scan.js — One-shot zombie scan runner for CI / manual use.
 *
 * Invokes a single zombie scan and exits.
 *
 * Usage:
 *   node scripts/run-zombie-scan.js
 *
 * Set SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN env vars
 * for real Salesforce data; otherwise falls back to mock dataset.
 */

const path = require("path");

async function main() {
  const { runZombieScan } = require(path.join(__dirname, "..", "lib", "zombie-scheduler"));

  console.log("[run-zombie-scan] Starting one-shot zombie scan...");
  const stats = await runZombieScan();
  console.log("[run-zombie-scan] Done:", JSON.stringify(stats));
  process.exit(0);
}

main().catch((err) => {
  console.error("[run-zombie-scan] Fatal:", err);
  process.exit(1);
});

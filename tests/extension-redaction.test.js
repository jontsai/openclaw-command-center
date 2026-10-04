const { test } = require("node:test");
const assert = require("node:assert/strict");
const { redactExtensionText } = require("../src/extension-redaction");
test("extension display text redacts common credential forms without changing ordinary data", () => {
  const fake = "synthetic".repeat(5);
  for (const value of [
    "Bearer " + fake,
    "Authorization: Basic " + fake,
    "ghp_" + fake,
    "sk-" + fake,
    "api_key=" + fake,
    ["password", JSON.stringify(fake)].join("="),
  ]) {
    assert.doesNotMatch(redactExtensionText(value), new RegExp(fake));
    assert.match(redactExtensionText(value), /REDACTED/);
  }
  assert.equal(redactExtensionText("Example | $100/mo | HIGH"), "Example | $100/mo | HIGH");
  const pem = ["-----BEGIN " + "PRIVATE KEY-----", fake, "-----END " + "PRIVATE KEY-----"].join(
    "\n",
  );
  assert.equal(redactExtensionText(pem), "[REDACTED PRIVATE KEY]");
});

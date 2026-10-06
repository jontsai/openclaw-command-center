const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shipped source and generated assets contain no embedded channel identifiers", () => {
  const root = path.resolve(__dirname, "..");
  const violations = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && /\.(js|html|json)$/.test(file)) {
        const text = fs.readFileSync(file, "utf8");
        const candidates = text.match(/\b[CG][0-9][A-Z0-9]{7,11}\b/gi) || [];
        // Ignore ordinary words and explicitly synthetic all-zero examples.
        if (candidates.some((id) => /\d/.test(id) && !/^[CG]0+$/i.test(id)))
          violations.push(path.relative(root, file));
      }
    }
  }
  for (const dir of ["src", "lib", "public"]) scan(path.join(root, dir));
  // Report paths only: never echo detected private values into public CI logs.
  assert.deepEqual(violations, [], "Embedded channel identifiers in shipped files");
});

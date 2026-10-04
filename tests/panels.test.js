const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, beforeEach, afterEach } = require("node:test");
const { createPipelineModule } = require("../src/pipeline");
const { createMonetizationModule } = require("../src/monetization");
const { createIntelModule } = require("../src/intel");
let workspace;
let deps;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "panel-fixtures-"));
  fs.mkdirSync(path.join(workspace, "intel"));
  deps = { CONFIG: { paths: { workspace } } };
});
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));
function fixture(file, text) {
  fs.writeFileSync(path.join(workspace, "intel", file), text);
}
function firms(rows, headers = "Company | Revenue | Milestone | Blocker | Priority") {
  fixture(
    "MONETIZATION-TRACKER.md",
    `| ${headers} |\n| ${headers
      .split("|")
      .map(() => "---")
      .join(" | ")} |\n${rows}`,
  );
  return createMonetizationModule(deps).getMonetizationStats();
}
test("blank pipeline cells do not shift Status; escaped pipes stay within a cell", () => {
  fixture(
    "SALES-PIPELINE.md",
    "| Name | Owner | Status |\n|---|---|---|\n| Example \\| Partners | | DONE |\n| Other | | |\n",
  );
  const data = createPipelineModule(deps).getPipelineStats().pipelines[0];
  assert.equal(data.totalItems, 2);
  assert.equal(data.statusCounts.DONE, 1);
  assert.equal(Object.keys(data.statusCounts).length, 1);
});
test("blank blockers and truncated rows render without a crash", () => {
  const data = firms("| Example | $100 | Launch | | HIGH |\n| Incomplete |\n");
  assert.equal(data.totalFirms, 2);
  assert.equal(data.firms[0].blocker, "");
  assert.equal(data.firms[0].priority, "HIGH");
  assert.equal(data.firms[1].priority, "");
  assert.equal(data.highPriority, 1);
});
test("reordered, lowercase headers and absent optional columns are supported", () => {
  const data = firms("| HIGH | Example |\n", "priority | company");
  assert.equal(data.firms[0].name, "Example");
  assert.equal(data.firms[0].revenue, "");
  assert.equal(data.highPriority, 1);
  assert.equal(data.revenueFirms, 0);
});
test("Czech Firma header and escaped name pipes retain column alignment", () => {
  const data = firms(
    "| Example \\| Partners | 100 CZK | Ship | | LOW |\n",
    "Firma | Revenue | Milestone | Blocker | Priority",
  );
  assert.equal(data.firms[0].name, "Example | Partners");
  assert.equal(data.firms[0].priority, "LOW");
});
test("only explicit positive amounts count as active revenue", () => {
  const amounts = [
    "Pending",
    "-",
    "N/A",
    "",
    "$0",
    "$0.00",
    "0 USD",
    "€0",
    "-$10",
    "-10",
    "100 prospects",
    "$0.50",
    "$1,250.00",
    "100 CZK",
    "USD 20/mo",
  ];
  const data = firms(
    amounts.map((amount, i) => `| Example ${i} | ${amount} | Launch | None | LOW |`).join("\n"),
  );
  assert.equal(data.totalFirms, amounts.length);
  assert.equal(data.revenueFirms, 4);
});
test("malformed table separators are not accepted as data tables", () => {
  fixture("SALES-QUEUE.md", "| Name | Status |\n| not-a-separator | --- |\n| Example | DONE |\n");
  assert.equal(createPipelineModule(deps).getPipelineStats().pipelines[0].totalItems, 0);
});
test("missing intel directory produces empty panel states", () => {
  fs.rmdirSync(path.join(workspace, "intel"));
  assert.equal(createIntelModule(deps).getIntelStats().totalFiles, 0);
  assert.equal(createPipelineModule(deps).getPipelineStats().pipelines.length, 0);
  assert.equal(createMonetizationModule(deps).getMonetizationStats().totalFirms, 0);
});
test("agent names matching object prototype keys are counted normally", () => {
  fixture("brief.md", "Agent: __proto__\n");
  assert.equal(createIntelModule(deps).getIntelStats().assignments.__proto__, 1);
});
test("rendered priority cannot escape its attribute; unknown text stays escaped", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const start = html.indexOf("function renderMonetization(");
  const end = html.indexOf("// Helper: format relative time", start);
  let rendered;
  const context = {
    document: { getElementById: () => ({}) },
    $set: () => {},
    escapeHtml: (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      ),
    smartUpdate: (_el, text) => {
      rendered = text;
    },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.renderMonetization({
    firms: [
      { name: "Example", priority: 'high" onmouseover="&#97;&#108;&#101;&#114;&#116;(1)' },
      { name: "Normal", priority: "HIGH" },
    ],
  });
  assert.doesNotMatch(rendered, /\sONMOUSEOVER="/i);
  assert.match(rendered, /class="monetization-priority UNKNOWN"/);
  assert.match(rendered, /class="monetization-priority HIGH"/);
  assert.match(rendered, /&quot;/);
});

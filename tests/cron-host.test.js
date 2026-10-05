const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCronHost } = require("../src/cron");
test("modern cron catalog is cached/coalesced and only display fields leave the adapter", async () => {
  let calls = 0,
    tick = 1000;
  const host = createCronHost({
    now: () => tick,
    run: async (args) => {
      calls++;
      assert.deepEqual(args.slice(0, 6), ["cron", "list", "--agent", "main", "--all", "--json"]);
      return JSON.stringify({
        jobs: [
          {
            id: "sample",
            name: "Example",
            payload: { message: "private prompt" },
            nextRunAtMs: Date.now() + 60000,
            schedule: { kind: "every", everyMs: 60000 },
          },
        ],
        total: 1,
      });
    },
  });
  assert.equal(host.getState().status, "loading");
  await Promise.all([host.refresh(), host.refresh()]);
  assert.equal(calls, 1);
  assert.equal(host.getState().status, "available");
  assert.equal(host.getState().jobs[0].schedule, "every 60s");
  assert.ok(!JSON.stringify(host.getState()).includes("private prompt"));
  tick += 100;
  host.getState();
  assert.equal(calls, 1);
});
test("failures preserve old observation but show stale, not authoritative zero", async () => {
  let fail = false;
  const host = createCronHost({
    run: async () => (fail ? null : JSON.stringify({ jobs: [{ id: "one" }], hasMore: true })),
  });
  await host.refresh();
  assert.equal(host.getState().status, "partial");
  const observed = host.getState().observedAt;
  fail = true;
  await host.refresh();
  assert.equal(host.getState().status, "stale");
  assert.equal(host.getState().jobs.length, 1);
  assert.equal(host.getState().observedAt, observed);
  const empty = createCronHost({ run: async () => null });
  await empty.refresh();
  assert.equal(empty.getState().status, "unavailable");
});
test("malformed catalog is unavailable; confirmed empty catalog is available", async () => {
  for (const value of [{}, { jobs: [{}] }, { jobs: "bad" }]) {
    const h = createCronHost({ run: async () => JSON.stringify(value) });
    await h.refresh();
    assert.equal(h.getState().status, "unavailable");
  }
  const h = createCronHost({ run: async () => JSON.stringify({ jobs: [], total: 0 }) });
  await h.refresh();
  assert.equal(h.getState().status, "available");
  assert.deepEqual(h.getState().jobs, []);
});
test("automation names and schedules remain data, and pagination stays partial", async () => {
  const h = createCronHost({
    run: async () =>
      JSON.stringify({
        jobs: [{ id: "one", name: "<img src=x>", schedule: { kind: "cron", expr: "<unsafe>" } }],
        total: 2,
      }),
  });
  await h.refresh();
  assert.equal(h.getState().status, "partial");
  assert.equal(h.getState().jobs[0].name, "<img src=x>");
});

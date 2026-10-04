const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const read = (name) => fs.readFileSync(path.join(__dirname, "../public/js", name), "utf8");
function harness(shared) {
  const sources = [];
  class EventSource {
    constructor(url) {
      this.url = String(url);
      this.listeners = {};
      sources.push(this);
    }
    addEventListener(k, fn) {
      this.listeners[k] = fn;
    }
    close() {
      this.closed = true;
    }
  }
  const window = { addEventListener() {}, removeEventListener() {} };
  const context = {
    window,
    EventSource,
    SharedWorker: shared,
    document: { baseURI: "http://example.local/fleet/agent/" },
    URL,
    setTimeout,
  };
  vm.runInNewContext(read("state-stream.js"), context);
  return { sources, connect: window.DashboardEvents.connect };
}
test("sidebar and dashboard share fallback stream; closing one retains the other", () => {
  const h = harness();
  const a = h.connect(),
    b = h.connect();
  let updates = 0;
  b.addEventListener("update", () => updates++);
  assert.equal(h.sources.length, 1);
  a.close();
  assert.ok(!h.sources[0].closed);
  h.sources[0].listeners.update({ data: "{}" });
  assert.equal(updates, 1);
  b.close();
  assert.equal(h.sources[0].closed, true);
});
test("asynchronous worker load failure falls back once per page", () => {
  const workers = [];
  class SharedWorker {
    constructor(url) {
      this.url = String(url);
      this.port = { start() {}, postMessage() {}, close() {} };
      workers.push(this);
    }
  }
  const h = harness(SharedWorker);
  const a = h.connect(),
    b = h.connect();
  assert.match(workers[0].url, /\/fleet\/agent\/js\/state-worker.js$/);
  workers.forEach((w) => w.onerror());
  const c = h.connect();
  assert.equal(h.sources.length, 1);
  assert.equal(workers.length, 2);
  a.close();
  b.close();
  c.close();
  assert.equal(h.sources[0].closed, true);
});
test("worker multiplexes tabs, replays latest update and releases the last stream", () => {
  const sources = [];
  class EventSource {
    constructor(url) {
      this.url = String(url);
      this.listeners = {};
      this.readyState = 1;
      sources.push(this);
    }
    addEventListener(k, fn) {
      this.listeners[k] = fn;
    }
    close() {
      this.closed = true;
    }
  }
  const self = { location: { href: "http://example.local/fleet/agent/js/state-worker.js" } };
  vm.runInNewContext(read("state-worker.js"), { self, EventSource, URL });
  function connect() {
    const p = {
      messages: [],
      postMessage(m) {
        this.messages.push(m);
      },
      start() {},
      close() {},
    };
    self.onconnect({ ports: [p] });
    p.onmessage({ data: { type: "start" } });
    return p;
  }
  const a = connect();
  sources[0].listeners.update({ data: '{"value":1}' });
  const b = connect();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "http://example.local/fleet/agent/api/events");
  assert.equal(b.messages.at(-1).data, '{"value":1}');
  a.onmessage({ data: { type: "close" } });
  assert.ok(!sources[0].closed);
  b.onmessage({ data: { type: "close" } });
  assert.equal(sources[0].closed, true);
});

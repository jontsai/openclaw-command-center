/* One EventSource serves all components/tabs for this dashboard mount. */
const ports = new Set();
let source = null,
  latest = null;
function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}
function start() {
  if (source) return;
  source = new EventSource(new URL("../api/events", self.location.href));
  for (const type of ["open", "error", "connected", "update", "heartbeat"])
    source.addEventListener(type, (event) => {
      const message = { type, data: event.data };
      if (type === "update") latest = message;
      broadcast(message);
    });
}
self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data.type === "close") {
      ports.delete(port);
      port.close();
      if (!ports.size) {
        source?.close();
        source = null;
        latest = null;
      }
      return;
    }
    if (data.type === "start") {
      ports.add(port);
      start();
      if (source.readyState === 1) port.postMessage({ type: "open" });
      if (latest) port.postMessage(latest);
    }
  };
  port.start();
};

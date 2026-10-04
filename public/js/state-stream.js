/* Share one live stream per dashboard across tabs, with a per-page fallback. */
(() => {
  let localSource = null;
  let sharedDisabled = false;
  const localClients = new Set();
  const kinds = ["open", "error", "connected", "update", "heartbeat"];
  function connect() {
    const listeners = new Map();
    let closed = false,
      port = null,
      deliver;
    const client = {
      onopen: null,
      onerror: null,
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      close() {
        if (closed) return;
        closed = true;
        if (port) {
          port.postMessage({ type: "close" });
          port.close();
        } else {
          localClients.delete(deliver);
          if (!localClients.size && localSource) {
            localSource.close();
            localSource = null;
          }
        }
        window.removeEventListener("pagehide", client.close);
      },
    };
    deliver = ({ type, data }) => {
      if (closed) return;
      const event = { type, data };
      client["on" + type]?.(event);
      for (const fn of listeners.get(type) || []) fn(event);
    };
    function useLocal() {
      if (closed || localClients.has(deliver)) return;
      if (port) {
        port.close();
        port = null;
      }
      localClients.add(deliver);
      if (!localSource) {
        localSource = new EventSource("api/events");
        for (const type of kinds)
          localSource.addEventListener(type, (e) => {
            for (const fn of localClients) fn({ type, data: e.data });
          });
      } else if (localSource.readyState === 1) setTimeout(() => deliver({ type: "open" }), 0);
    }
    try {
      if (sharedDisabled || typeof SharedWorker === "undefined")
        throw Error("SharedWorker unavailable");
      const worker = new SharedWorker(new URL("js/state-worker.js", document.baseURI));
      port = worker.port;
      port.onmessage = (e) => deliver(e.data);
      port.start();
      port.postMessage({ type: "start" });
      worker.onerror = () => {
        sharedDisabled = true;
        useLocal();
      };
    } catch {
      useLocal();
    }
    window.addEventListener("pagehide", client.close);
    return client;
  }
  window.DashboardEvents = { connect };
})();

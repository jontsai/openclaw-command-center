#!/usr/bin/env node
// Synthetic-only UI preview. Never loads workspace config, memories or credentials.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { validateKnowledge } = require("../src/knowledge");
const publicRoot = path.resolve(__dirname, "../public");
const fixture = require("../tests/fixtures/knowledge.json");
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/preview(?=\/)/, "");
    if (pathname === "/api/knowledge") {
      const data = JSON.parse(JSON.stringify(fixture));
      // Clearly synthetic preview; freshness belongs to this demonstration only.
      data.sources.forEach((s) => {
        s.observedAt = new Date().toISOString();
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(validateKnowledge(data)));
      return;
    }
    if (pathname.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    const file = path.resolve(publicRoot, `.${pathname === "/" ? "/knowledge.html" : pathname}`);
    if (!file.startsWith(publicRoot + path.sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      let body = fs.readFileSync(file);
      const ext = path.extname(file);
      if (ext === ".html")
        body = Buffer.from(
          body
            .toString()
            .replace(
              "<body>",
              '<body style="padding-top:36px"><div style="padding:8px;text-align:center;background:#48385c;color:white;position:fixed;top:0;left:0;right:0;z-index:1000">SYNTHETIC PREVIEW · 示例预览 · Not connected to a live workspace</div>',
            ),
        );
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".svg": "image/svg+xml",
          }[ext] || "text/plain",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(Number(process.env.PORT || 18340), "127.0.0.1", () =>
    console.log("Synthetic knowledge preview ready"),
  );

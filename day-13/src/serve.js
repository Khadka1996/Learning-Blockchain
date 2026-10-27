"use strict";
/**
 * Tiny static file server for the frontend (no dependencies).
 * Binds to 127.0.0.1 only and refuses paths outside frontend/.
 *   node src/serve.js [port]   → http://127.0.0.1:5173
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "frontend");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

function resolveSafe(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null; // malformed % escape
  }
  if (p.includes("\0")) return null;
  if (p.endsWith("/")) p += "index.html";
  const full = path.resolve(ROOT, "." + p);
  return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null;
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const file = resolveSafe(req.url || "/");
    if (!file) {
      res.writeHead(400).end("bad path");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        // Clickjacking: nobody may put the dApp inside an invisible iframe and trick
        // a click on "Send tip" (QA finding L4). `frame-ancestors` can't be set in a <meta>.
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || 5173);
  createServer().listen(port, "127.0.0.1", () => console.log(`dApp on http://127.0.0.1:${port}  (Ctrl+C to stop)`));
}

module.exports = { createServer, resolveSafe, ROOT };

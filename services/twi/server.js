/**
 * Sentinel Twi Voice Service Server.
 * Runs standalone on port 3001 (or process.env.TWI_PORT).
 *
 * Uses Node's built-in http server with Express/Connect dispatcher support.
 * Serves /api/twi/* endpoints with full CORS for browser access.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { handleTwiRequest } = require("./routes/twi");
const { prewarmCache } = require("./khaya");

const PORT = parseInt(process.env.TWI_PORT || "3001", 10);

const server = http.createServer((req, res) => {
  const handled = handleTwiRequest(req, res);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", path: req.url }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[sentinel-twi] Khaya AI Voice Service listening on port ${PORT}`);
  console.log(`[sentinel-twi] Health: http://localhost:${PORT}/api/twi/health`);

  // Pre-generate and cache fixed phrases in the background
  prewarmCache()
    .then(() => console.log("[sentinel-twi] Fixed phrases cache pre-warmed."))
    .catch((err) => console.warn("[sentinel-twi] Background cache pre-warm note:", err.message));
});

module.exports = server;

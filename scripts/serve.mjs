import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split("?")[0]);

  // Convenience redirects matching vercel.json
  if (reqPath === "/contact") {
    res.writeHead(302, { Location: "/connect/" });
    return res.end();
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);

  // Clean URLs & directory resolution
  try {
    let stat = fs.existsSync(filePath) && fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    } else if (!stat) {
      // Try path + .html or path/index.html
      if (fs.existsSync(filePath + ".html")) {
        filePath = filePath + ".html";
      } else if (fs.existsSync(path.join(filePath, "index.html"))) {
        filePath = path.join(filePath, "index.html");
      }
    }
  } catch (err) {}

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>404 - Page Not Found</h2><p><a href="/">Return to Home</a></p></body></html>`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Quant Flow Capital — Local Dev Server Running`);
  console.log(`======================================================`);
  console.log(`  > Overview:    http://localhost:${PORT}/`);
  console.log(`  > Monitor:     http://localhost:${PORT}/monitor/`);
  console.log(`  > Markets:     http://localhost:${PORT}/markets/`);
  console.log(`  > Library:     http://localhost:${PORT}/library/`);
  console.log(`  > About:       http://localhost:${PORT}/about/`);
  console.log(`  > Connect:     http://localhost:${PORT}/connect/`);
  console.log(`======================================================\n`);
});

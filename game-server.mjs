import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 8010);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
};

function resolvePath(url) {
  const clean = decodeURIComponent(new URL(url, `http://127.0.0.1:${port}`).pathname);
  const requested = clean === "/" ? "/index.html" : clean;
  const full = normalize(join(root, requested));
  return full.startsWith(root) ? full : null;
}

const server = createServer((req, res) => {
  const file = resolvePath(req.url || "/");
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`Game server listening on http://127.0.0.1:${port}/index.html`);
});

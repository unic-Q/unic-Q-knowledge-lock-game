import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  if (req.method === "GET" && req.url === "/api/exported-levels") {
    const outDir = join(root, "关卡导出");
    const allPath = join(outDir, "all-levels.json");
    const mapPath = join(outDir, "map-layout.json");
    let payload = { version: 1, cols: 20, rows: 20, rooms: [] };
    let map = { version: 1, positions: {} };

    try {
      if (existsSync(allPath)) {
        payload = JSON.parse(readFileSync(allPath, "utf8"));
      } else if (existsSync(outDir)) {
        payload.rooms = readdirSync(outDir)
          .filter((name) => /^room-\d+\.json$/i.test(name))
          .map((name) => JSON.parse(readFileSync(join(outDir, name), "utf8")))
          .sort((a, b) => (a.room || 0) - (b.room || 0));
      }
      if (existsSync(mapPath)) map = JSON.parse(readFileSync(mapPath, "utf8"));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, ...payload, map }));
    } catch (error) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/export-levels") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
        const outDir = join(root, "关卡导出");
        mkdirSync(outDir, { recursive: true });
        for (const room of rooms) {
          if (!Number.isInteger(room.room)) continue;
          const filename = `room-${String(room.room).padStart(2, "0")}.json`;
          writeFileSync(join(outDir, filename), `${JSON.stringify(room, null, 2)}\n`, "utf8");
        }
        writeFileSync(join(outDir, "all-levels.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, dir: outDir, count: rooms.length }));
      } catch (error) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/save-map-layout") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const outDir = join(root, "关卡导出");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "map-layout.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, dir: outDir }));
      } catch (error) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
      }
    });
    return;
  }

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

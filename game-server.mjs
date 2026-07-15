import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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
        payload = readJsonFile(allPath);
      }
      if (existsSync(outDir)) {
        const roomsById = new Map((payload.rooms || []).map((room) => [Number(room.room ?? room.id), room]));
        for (const name of readdirSync(outDir).filter((entry) => /^room-\d+\.json$/i.test(entry))) {
          const room = readJsonFile(join(outDir, name));
          roomsById.set(Number(room.room ?? room.id), room);
        }
        payload.rooms = [...roomsById.values()].sort((a, b) => Number(a.room ?? a.id) - Number(b.room ?? b.id));
      }
      if (existsSync(mapPath)) map = readJsonFile(mapPath);
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
        const allPath = join(outDir, "all-levels.json");
        let existing = { version: 1, cols: payload.cols || 20, rows: payload.rows || 20, rooms: [] };
        if (existsSync(allPath)) {
          existing = readJsonFile(allPath);
        }
        const roomsById = new Map((existing.rooms || []).map((room) => [Number(room.room ?? room.id), room]));
        for (const room of rooms) {
          if (!Number.isInteger(room.room)) continue;
          const filename = `room-${String(room.room).padStart(2, "0")}.json`;
          writeFileSync(join(outDir, filename), `${JSON.stringify(room, null, 2)}\n`, "utf8");
          roomsById.set(room.room, room);
        }
        const merged = {
          ...existing,
          ...payload,
          rooms: [...roomsById.values()].sort((a, b) => Number(a.room ?? a.id) - Number(b.room ?? b.id)),
        };
        writeFileSync(allPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
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

  if (req.method === "POST" && req.url === "/api/delete-level") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const roomId = Number(JSON.parse(body || "{}").room);
        if (!Number.isInteger(roomId) || roomId < 1) throw new Error("无效的关卡编号");
        const outDir = join(root, "关卡导出");
        const roomPath = join(outDir, `room-${String(roomId).padStart(2, "0")}.json`);
        const allPath = join(outDir, "all-levels.json");
        const mapPath = join(outDir, "map-layout.json");
        if (existsSync(roomPath)) unlinkSync(roomPath);

        if (existsSync(allPath)) {
          const payload = readJsonFile(allPath);
          payload.rooms = (payload.rooms || []).filter((room) => Number(room.room ?? room.id) !== roomId);
          writeFileSync(allPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        }
        if (existsSync(mapPath)) {
          const map = readJsonFile(mapPath);
          if (map.positions) delete map.positions[String(roomId)];
          writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, room: roomId }));
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


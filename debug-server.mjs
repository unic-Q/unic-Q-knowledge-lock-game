import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

let latest = null;

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/debug") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        latest = JSON.parse(body);
        latest.receivedAt = new Date().toISOString();
        writeFileSync("debug-state.json", JSON.stringify(latest, null, 2));
        res.writeHead(204);
      } catch {
        res.writeHead(400);
      }
      res.end();
    });
    return;
  }

  if (req.method === "GET" && req.url === "/debug") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(latest ?? { error: "no debug state yet" }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(8011, "127.0.0.1", () => {
  console.log("Debug server listening on http://127.0.0.1:8011/debug");
});

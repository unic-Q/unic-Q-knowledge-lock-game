"use strict";

import { TILE, COLS, ROWS, FORMS, RED_QTE_READY, RED_QTE_TIME } from "./constants.js";
import { transformedRect, isGreenAfterimage } from "./physics.js";

function drawRect(ctx, r, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = stroke;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

function drawFlag(ctx, flag, raised, progress = 1) {
  const lift = raised ? 13 * (1 - progress) : 13;
  ctx.strokeStyle = "#f0dca2";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(flag.x + 4, flag.y + 27);
  ctx.lineTo(flag.x + 4, flag.y + 2);
  ctx.stroke();
  ctx.fillStyle = raised ? "#f4c95d" : "#8c7a52";
  ctx.beginPath();
  ctx.moveTo(flag.x + 5, flag.y + 4 + lift);
  ctx.lineTo(flag.x + 27, flag.y + 9 + lift);
  ctx.lineTo(flag.x + 5, flag.y + 15 + lift);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(244,201,93,0.18)";
  ctx.fillRect(flag.x - 3, flag.y + 24, 26, 4);
}

function drawHelmet(ctx, item) {
  const form = item.form || "red";
  ctx.fillStyle = "#d8dde7";
  ctx.beginPath();
  ctx.arc(item.x + 12, item.y + 13, 12, Math.PI, Math.PI * 2);
  ctx.lineTo(item.x + 24, item.y + 20);
  ctx.lineTo(item.x, item.y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#f4c95d";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = FORMS[form].color;
  ctx.fillRect(item.x + 5, item.y + 15, 14, 3);
}

function drawPlagueStain(ctx, stain, alpha = 1) {
  if (stain.cell) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = "rgba(235,247,225,0.56)";
    ctx.fillRect(stain.x + 3, stain.y + 3, stain.w - 6, stain.h - 6);
    ctx.strokeStyle = "rgba(147,176,132,0.86)";
    ctx.lineWidth = 2;
    ctx.strokeRect(stain.x + 4, stain.y + 4, stain.w - 8, stain.h - 8);
    ctx.fillStyle = "rgba(147,176,132,0.5)";
    ctx.beginPath();
    ctx.ellipse(stain.x + 12, stain.y + 13, 5, 8, 0.3, 0, Math.PI * 2);
    ctx.ellipse(stain.x + 22, stain.y + 20, 4, 6, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (Number.isFinite(stain.a) && Number.isFinite(stain.b)) {
    drawPlagueSegment(ctx, stain, alpha);
    return;
  }

  const nx = stain.nx ?? 0;
  const ny = stain.ny ?? -1;
  const tx = stain.tx ?? -ny;
  const ty = stain.ty ?? nx;
  const len = stain.len ?? 20;
  const thick = stain.thick ?? 10;
  const edgeX = stain.x;
  const edgeY = stain.y;
  const inset = 3;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(edgeX - nx * inset, edgeY - ny * inset);
  ctx.rotate(Math.atan2(ty, tx));

  ctx.fillStyle = "rgba(235,247,225,0.76)";
  ctx.beginPath();
  ctx.ellipse(0, 0, len / 2, thick / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(147,176,132,0.58)";
  ctx.beginPath();
  ctx.ellipse(-len * 0.12, 0, len * 0.28, thick * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const dripCount = 1 + (stain.drip % 3);
  for (let i = 0; i < dripCount; i += 1) {
    const offset = -len * 0.35 + i * len * 0.32 + (stain.drip % 2) * 3;
    const drop = 4 + ((stain.drip + i) % 4) * 2;
    ctx.fillStyle = `rgba(235,247,225,${0.28 + i * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(offset, thick * 0.35 + drop * 0.45, 3.5, drop, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPlagueSegment(ctx, segment, alpha = 1) {
  const step = 13;
  const start = Math.floor(segment.a / step) * step;
  const end = segment.b;
  for (let t = start; t <= end; t += step) {
    if (t < segment.a) continue;
    const seed = segment.seed * 97 + Math.round(t);
    const jitter = ((seed * 13) % 7) - 3;
    const sampleT = Math.max(segment.a, Math.min(segment.b, t + jitter));
    const len = 16 + (seed % 5) * 3;
    const thick = segment.thick + (seed % 3);
    const x = segment.tx * sampleT + segment.nx * segment.n;
    const y = segment.ty * sampleT + segment.ny * segment.n;
    drawPlagueStain(ctx, {
      x,
      y,
      nx: segment.nx,
      ny: segment.ny,
      tx: segment.tx,
      ty: segment.ty,
      len,
      thick,
      drip: seed % 5,
    }, alpha);
  }
}

export function draw(ctx, state) {
  const { room, player } = state;
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  ctx.fillStyle = "#dfe8ed";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const b of room.blocks) if (!b.broken) drawRect(ctx, transformedRect(state, b), "#607487", "#314252");
  for (const b of room.platforms) drawRect(ctx, transformedRect(state, b), "#758698", "#40505f");
  for (const b of room.cracks) if (!b.broken) drawRect(ctx, transformedRect(state, b), "#774849", "#c87c7d");
  for (const b of room.erode) if (!b.broken) {
    const r = transformedRect(state, b);
    drawRect(ctx, r, `rgba(94,82,50,${0.35 + b.hp * 0.55})`, "#bda366");
    ctx.fillStyle = "#15130f";
    ctx.fillRect(r.x + 6, r.y + 6, (r.w - 12) * Math.max(0, b.hp), 4);
  }
  for (const b of room.hidden) {
    if (isGreenAfterimage(state)) drawRect(ctx, transformedRect(state, b), "rgba(127,160,131,0.6)", "#b8dbc0");
  }
  for (const a of room.anchors) {
    ctx.fillStyle = "#f4f2e6";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of room.plagueHazards) {
    drawPlagueStain(ctx, p, 1);
  }
  for (const p of player.plague) {
    drawPlagueStain(ctx, p, 0.82);
  }
  for (let i = 1; i < player.graves.length; i += 1) {
    ctx.strokeStyle = state.form === "green" ? "#9fd2ad" : "#53605a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.graves[i - 1].x + 14, player.graves[i - 1].y + 16);
    ctx.lineTo(player.graves[i].x + 14, player.graves[i].y + 16);
    ctx.stroke();
  }
  for (const g of player.graves) drawRect(ctx, { x: g.x, y: g.y, w: 28, h: 32 }, "#617064", "#a4bea8");
  if (room.flag) drawFlag(ctx, transformedRect(state, room.flag), state.raisedFlags.has(room.id), room.flagProgress ?? 1);
  if (room.helmet && !state.worldRooms[state.roomIndex].helmet.taken) drawHelmet(ctx, room.helmet);

  if (player.hook && player.hookTime > 0) {
    ctx.strokeStyle = player.hook.hit ? "#f4f2e6" : "rgba(244,242,230,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + 12, player.y + 14);
    ctx.lineTo(player.hook.x, player.hook.y);
    ctx.stroke();
    if (player.hook.hit) {
      ctx.fillStyle = "#f4f2e6";
      ctx.beginPath();
      ctx.arc(player.hook.x, player.hook.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#111923";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.save();
  if (isGreenAfterimage(state)) ctx.globalAlpha = 0.3;
  ctx.fillStyle = state.form === "green" && !isGreenAfterimage(state) ? "#56735c" : FORMS[state.form].color;
  ctx.fillRect(player.x, player.y, player.w, player.h);
  ctx.strokeStyle = "rgba(17,25,35,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(player.x + 0.5, player.y + 0.5, player.w - 1, player.h - 1);
  if (player.plagueGrace > 0) {
    ctx.strokeStyle = "rgba(244,242,230,0.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect(player.x - 3, player.y - 3, player.w + 6, player.h + 6);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#111923";
  ctx.fillRect(player.x + 6, player.y + 9, 4, 4);
  ctx.fillRect(player.x + 15, player.y + 9, 4, 4);
  ctx.restore();

  drawRedQte(ctx, player);
  if (state.form === "black") {
    ctx.fillStyle = "#d6c08a";
    ctx.font = "700 20px Microsoft YaHei, sans-serif";
    ctx.fillText(["→", "↓", "←", "↑"][state.worldRot], 24, 34);
  }
  if (state.choosing) drawChoiceOverlay(ctx, state);
  if (state.mapOpen) drawMapOverlay(ctx, state);
  ctx.restore();
}

function drawMapOverlay(ctx, state) {
  const positions = buildRoomPositions(state.worldRooms);
  const explored = state.exploredRooms || new Set();
  const exploredPositions = state.worldRooms
    .filter((room) => explored.has(room.id))
    .map((room) => positions.get(room.id))
    .filter(Boolean);

  ctx.save();
  ctx.fillStyle = "rgba(10, 14, 20, 0.78)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.font = "700 24px Microsoft YaHei, sans-serif";
  ctx.fillStyle = "#e8eef4";
  ctx.textAlign = "left";
  ctx.fillText("地图", 52, 58);
  ctx.font = "14px Microsoft YaHei, sans-serif";
  ctx.fillStyle = "rgba(232,238,244,0.72)";
  ctx.fillText("已探索房间按缩略图拼接；未知房间隐藏", 52, 84);

  if (!exploredPositions.length) {
    ctx.restore();
    return;
  }

  const minX = Math.min(...exploredPositions.map((p) => p.x));
  const maxX = Math.max(...exploredPositions.map((p) => p.x));
  const minY = Math.min(...exploredPositions.map((p) => p.y));
  const maxY = Math.max(...exploredPositions.map((p) => p.y));
  const mapCols = maxX - minX + 1;
  const mapRows = maxY - minY + 1;
  const roomSize = Math.max(22, Math.floor(Math.min(
    126,
    (ctx.canvas.width - 96) / mapCols,
    (ctx.canvas.height - 150) / mapRows,
  )));
  const mapW = mapCols * roomSize;
  const mapH = mapRows * roomSize;
  const originX = Math.round((ctx.canvas.width - mapW) / 2 - minX * roomSize);
  const originY = Math.round((ctx.canvas.height - mapH) / 2 - minY * roomSize + 24);

  for (const room of state.worldRooms) {
    if (!explored.has(room.id)) continue;
    const pos = positions.get(room.id);
    if (!pos) continue;
    const x = originX + pos.x * roomSize;
    const y = originY + pos.y * roomSize;
    drawRoomThumbnail(ctx, state, room, x, y, roomSize, positions, explored);
  }

  ctx.font = "13px Microsoft YaHei, sans-serif";
  ctx.fillStyle = "rgba(232,238,244,0.66)";
  ctx.textAlign = "right";
  ctx.fillText("M / Esc 关闭", ctx.canvas.width - 52, ctx.canvas.height - 42);
  ctx.restore();
}

function drawRoomThumbnail(ctx, state, room, x, y, roomSize, positions, explored) {
  const cell = roomSize / COLS;
  ctx.fillStyle = "#17222c";
  ctx.fillRect(x, y, roomSize, roomSize);

  const colors = {
    "#": "#607487",
    "=": "#758698",
    X: "#875052",
    H: "#3e654d",
    E: "#6d5d38",
    P: "#dcebd6",
    A: "rgba(244,242,230,0.18)",
  };

  for (let row = 0; row < ROWS; row += 1) {
    const line = room.blocks[row] || "";
    for (let col = 0; col < COLS; col += 1) {
      const ch = line[col] || ".";
      const color = colors[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell));
      if (ch === "A") {
        ctx.fillStyle = "#f4f2e6";
        ctx.beginPath();
        ctx.arc(x + (col + 0.5) * cell, y + (row + 0.5) * cell, Math.max(1.5, cell * 0.32), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (room.flag) {
    ctx.fillStyle = "#f4c95d";
    ctx.fillRect(x + (room.flag.x / TILE) * cell, y + (room.flag.y / TILE) * cell, Math.max(2, cell * 0.6), Math.max(3, cell * 1.2));
  }
  if (room.helmet && !room.helmet.taken) {
    ctx.fillStyle = FORMS[room.helmet.form || "red"].color;
    ctx.beginPath();
    ctx.arc(x + ((room.helmet.x + room.helmet.w / 2) / TILE) * cell, y + ((room.helmet.y + room.helmet.h / 2) / TILE) * cell, Math.max(2, cell * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  drawUnknownExitMarks(ctx, room, x, y, roomSize, explored);

  const isCurrent = room.id === state.room.id;
  ctx.strokeStyle = isCurrent ? "#f4c95d" : "rgba(128,146,164,0.58)";
  ctx.lineWidth = isCurrent ? 3 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, roomSize - 1, roomSize - 1);
  if (isCurrent) {
    ctx.fillStyle = "#f4c95d";
    ctx.font = "700 11px Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(room.id), x + roomSize / 2, y + 15);
  }
}

function drawUnknownExitMarks(ctx, room, x, y, roomSize, explored) {
  const mark = Math.max(6, roomSize * 0.12);
  ctx.strokeStyle = "rgba(244,201,93,0.78)";
  ctx.lineWidth = Math.max(2, roomSize * 0.018);
  ctx.beginPath();
  for (const [dir, targetId] of Object.entries(room.links)) {
    if (explored.has(targetId)) continue;
    if (dir === "l") {
      ctx.moveTo(x, y + roomSize / 2 - mark);
      ctx.lineTo(x, y + roomSize / 2 + mark);
    } else if (dir === "r") {
      ctx.moveTo(x + roomSize, y + roomSize / 2 - mark);
      ctx.lineTo(x + roomSize, y + roomSize / 2 + mark);
    } else if (dir === "u") {
      ctx.moveTo(x + roomSize / 2 - mark, y);
      ctx.lineTo(x + roomSize / 2 + mark, y);
    } else if (dir === "d") {
      ctx.moveTo(x + roomSize / 2 - mark, y + roomSize);
      ctx.lineTo(x + roomSize / 2 + mark, y + roomSize);
    }
  }
  ctx.stroke();
}

function buildRoomPositions(rooms) {
  const positions = new Map([[1, { x: 0, y: 0 }]]);
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const dirs = {
    l: { x: -1, y: 0 },
    r: { x: 1, y: 0 },
    u: { x: 0, y: -1 },
    d: { x: 0, y: 1 },
  };
  const queue = [1];
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    const room = byId.get(id);
    const pos = positions.get(id);
    if (!room || !pos) continue;
    for (const [dir, targetId] of Object.entries(room.links)) {
      if (!byId.has(targetId) || positions.has(targetId)) continue;
      const delta = dirs[dir];
      if (!delta) continue;
      positions.set(targetId, { x: pos.x + delta.x, y: pos.y + delta.y });
      queue.push(targetId);
    }
  }
  return positions;
}

function drawRedQte(ctx, player) {
  if (!player.redQte) return;
  const t = Math.min(1, player.redQte.t / RED_QTE_TIME);
  const cx = player.x + 12;
  const cy = player.y - 12;
  const maxR = 22;
  const readyR = maxR * RED_QTE_READY;
  ctx.strokeStyle = "rgba(244, 201, 93, 0.34)";
  ctx.lineWidth = maxR - readyR;
  ctx.beginPath();
  ctx.arc(cx, cy, (maxR + readyR) / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(232, 77, 77, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(4, maxR * t), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4c95d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, readyR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.stroke();
}

function drawChoiceOverlay(ctx, state) {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cx = ctx.canvas.width / 2;
  const cy = ctx.canvas.height / 2;
  const items = [
    ["white", "白", cx, cy - 78],
    ["red", "红", cx + 86, cy],
    ["black", "黑", cx - 86, cy],
    ["green", "绿", cx, cy + 78],
  ];
  ctx.font = "700 22px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  for (const [id, text, x, y] of items) {
    const unlocked = state.unlockedForms?.has(id);
    ctx.globalAlpha = unlocked ? 1 : 0.24;
    ctx.fillStyle = state.selectedForm === id ? FORMS[id].color : "#596372";
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#10141b";
    ctx.fillText(text, x, y + 8);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

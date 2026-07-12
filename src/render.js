"use strict";

import {
  BLACK_GRAVITY, BLACK_JUMP, COLS, FORMS, GRAVITY, GREEN_GRAVITY, GREEN_JUMP, GREEN_MOVE,
  JUMP, MOVE, RED_DASH_DISTANCE, RED_QTE_READY, RED_QTE_TIME, ROWS, TILE,
  WHITE_HOOK_RANGE, WHITE_PLAGUE_SPEED, WHITE_SURFACE_SPEED,
} from "./constants.js";
import { transformedRect, isGreenAfterimage, rotatePoint } from "./physics.js";

function drawRect(ctx, r, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = stroke;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

function drawFlag(ctx, flag, raised, progress = 1, current = false) {
  const lift = raised ? 13 * (1 - progress) : 13;
  ctx.strokeStyle = "#f0dca2";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(flag.x + 4, flag.y + 27);
  ctx.lineTo(flag.x + 4, flag.y + 2);
  ctx.stroke();
  ctx.fillStyle = current ? "#74c476" : raised ? "#f4c95d" : "#8c7a52";
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
  ctx.fillStyle = "#7fa083";
  ctx.fillRect(item.x + 5, item.y + 15, 14, 3);
}

function drawAbility(ctx, item) {
  const colors = { green: "#7fa083", red: "#e84d4d", white: "#f4f2e6", black: "#252632" };
  ctx.fillStyle = colors[item.form] || "#f4c95d";
  ctx.beginPath();
  ctx.arc(item.x + item.w / 2, item.y + item.h / 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4c95d";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCoin(ctx, item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  ctx.save();
  ctx.fillStyle = "#f5c542";
  ctx.strokeStyle = "#a96f16";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(item.w, item.h) / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff1a8";
  ctx.fillRect(cx - 1, cy - 5, 2, 10);
  ctx.restore();
}

function drawHazard(ctx, h) {
  if (h.type === "electric") {
    ctx.strokeStyle = "#8ee6ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = h.x + 3; x < h.x + h.w; x += 8) {
      const y = h.y + ((x / 8) % 2 ? 8 : 24);
      if (x === h.x + 3) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    return;
  }
  ctx.fillStyle = "#9c3038";
  ctx.beginPath();
  ctx.moveTo(h.x, h.y + h.h);
  ctx.lineTo(h.x + h.w / 2, h.y + 4);
  ctx.lineTo(h.x + h.w, h.y + h.h);
  ctx.closePath();
  ctx.fill();
}

function drawEnemy(ctx, e) {
  if (!e.alive) return;
  ctx.fillStyle = "#3f273f";
  ctx.fillRect(e.x, e.y, e.w, e.h);
  ctx.fillStyle = "#f4c95d";
  ctx.fillRect(e.x + 5, e.y + 8, 4, 4);
  ctx.fillRect(e.x + e.w - 9, e.y + 8, 4, 4);
  if (e.advanced && Number.isFinite(e.maxHp) && e.maxHp > 1) {
    const ratio = Math.max(0, Math.min(1, Number(e.hp ?? e.maxHp) / e.maxHp));
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(e.x, e.y - 7, e.w, 4);
    ctx.fillStyle = "#f4c95d";
    ctx.fillRect(e.x, e.y - 7, e.w * ratio, 4);
  }
}

function drawSwitch(ctx, s) {
  ctx.fillStyle = s.pressed ? "#74c476" : "#d6c08a";
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = "#314252";
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
}

function drawLeverSwitch(ctx, s) {
  ctx.fillStyle = s.pressed ? "#74c476" : "#d89b63";
  ctx.fillRect(s.x + 3, s.y + s.h - 7, s.w - 6, 6);
  ctx.strokeStyle = "#314252";
  ctx.strokeRect(s.x + 3.5, s.y + s.h - 6.5, s.w - 7, 5);
  const dir = leverVector(s.initialSide || "right");
  const baseX = s.x + s.w / 2;
  const baseY = s.y + s.h / 2;
  ctx.strokeStyle = "#f4c95d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX + dir.x * 10, baseY + dir.y * 10);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function leverVector(side) {
  return {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
  }[side] || { x: 1, y: 0 };
}

function drawCheckpoint(ctx, f, current = false) {
  ctx.strokeStyle = "#f0dca2";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(f.x + 3, f.y + f.h);
  ctx.lineTo(f.x + 3, f.y + 2);
  ctx.stroke();
  ctx.fillStyle = current ? "#74c476" : "#f4c95d";
  ctx.beginPath();
  ctx.moveTo(f.x + 5, f.y + 4);
  ctx.lineTo(f.x + 22, f.y + 9);
  ctx.lineTo(f.x + 5, f.y + 15);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawPlatform(ctx, p) {
  const fill = "#758698";
  const stroke = "#40505f";
  drawRect(ctx, p, fill, stroke);
}

function drawGate(ctx, g) {
  const amount = Math.max(0, Math.min(1, g.openAmount || 0));
  if (amount >= 0.99) return;
  const h = g.h * (1 - amount);
  drawRect(ctx, { ...g, y: g.y + (g.h - h) / 2, h }, `rgba(60,74,86,${1 - amount * 0.7})`, "#f4c95d");
}

function drawLightning(ctx, segment, state) {
  if (segment.disabled) return;
  const a = rotatePoint(segment.ax, segment.ay, state.worldRot);
  const b = rotatePoint(segment.bx, segment.by, state.worldRot);
  ctx.save();
  ctx.strokeStyle = state.form === "green" ? "#9fd2ad" : "#35f28a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawCracks(ctx, r, level) {
  if (!level) return;
  ctx.strokeStyle = level > 1 ? "#f4c95d" : "#d8b56b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + 8, r.y + 7);
  ctx.lineTo(r.x + 16, r.y + 16);
  ctx.lineTo(r.x + 10, r.y + 26);
  if (level > 1) {
    ctx.moveTo(r.x + 22, r.y + 6);
    ctx.lineTo(r.x + 15, r.y + 18);
    ctx.lineTo(r.x + 25, r.y + 28);
  }
  ctx.stroke();
}

function drawPlagueStain(ctx, stain, alpha = 1) {
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

function drawReachableOverlay(ctx, state) {
  const cells = reachableCells(state);
  ctx.save();
  ctx.fillStyle = "rgba(244, 201, 93, 0.18)";
  ctx.strokeStyle = "rgba(244, 201, 93, 0.26)";
  for (const cell of cells) {
    ctx.fillRect(cell.x * TILE + 1, cell.y * TILE + 1, TILE - 2, TILE - 2);
    ctx.strokeRect(cell.x * TILE + 0.5, cell.y * TILE + 0.5, TILE - 1, TILE - 1);
  }
  ctx.restore();
}

function reachableCells(state) {
  const { player } = state;
  const cells = [];
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const tx = x * TILE + TILE / 2;
      const ty = y * TILE + TILE / 2;
      if (isCellBlocked(state, x, y)) continue;
      if (isReachablePoint(state, cx, cy, tx, ty)) cells.push({ x, y });
    }
  }
  return cells;
}

function isCellBlocked(state, gx, gy) {
  const probe = { x: gx * TILE + 4, y: gy * TILE + 4, w: TILE - 8, h: TILE - 8 };
  const solid = [...state.room.blocks, ...(state.room.gates || []).filter((g) => !g.open)];
  return solid.some((b) => !b.broken && rectsOverlap(probe, transformedRect(state, b)));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isReachablePoint(state, sx, sy, tx, ty) {
  const dx = Math.abs(tx - sx);
  const dy = ty - sy;
  if (state.form === "red") return dx + Math.abs(dy) <= RED_DASH_DISTANCE + TILE * 0.75;
  if (state.form === "white") {
    const surfaceSpeed = playerOnPlague(state) ? WHITE_PLAGUE_SPEED : WHITE_SURFACE_SPEED;
    return Math.hypot(dx, dy) <= WHITE_HOOK_RANGE + TILE * 0.5 || dx + Math.abs(dy) <= surfaceSpeed * 1.15;
  }
  if (state.form === "green" && isGreenAfterimage(state)) return Math.hypot(dx, dy) <= GREEN_MOVE * 1.25;
  if (state.form === "green") return projectileReach(dx, dy, GREEN_MOVE, GREEN_JUMP, GREEN_GRAVITY);
  if (state.form === "black") return projectileReach(dx, dy, MOVE * 0.25, BLACK_JUMP, BLACK_GRAVITY);
  return projectileReach(dx, dy, MOVE, JUMP, GRAVITY, true);
}

function projectileReach(dx, dy, speed, jump, gravity, doubleJump = false) {
  const maxHeight = (jump * jump) / (2 * gravity);
  const effectiveJump = doubleJump ? jump * 1.32 : jump;
  if (dy < -maxHeight * (doubleJump ? 1.8 : 1) - TILE * 0.5) return false;
  const disc = effectiveJump * effectiveJump + 2 * gravity * dy;
  if (disc < 0) return false;
  const t = (effectiveJump + Math.sqrt(disc)) / gravity;
  return dx <= speed * t + TILE * 0.75;
}

function playerOnPlague(state) {
  const px = state.player.x + state.player.w / 2;
  const py = state.player.y + state.player.h / 2;
  return state.player.plague.some((p) => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return false;
    const t = px * p.tx + py * p.ty;
    const n = px * p.nx + py * p.ny;
    const clamped = Math.max(Math.min(p.a, p.b), Math.min(Math.max(p.a, p.b), t));
    return Math.hypot(t - clamped, n - p.n) < 22;
  });
}

export function draw(ctx, state) {
  const { room, player } = state;
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  ctx.fillStyle = "#dfe8ed";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const b of room.blocks) if (!b.broken) {
    const r = transformedRect(state, b);
    drawRect(ctx, r, "#607487", "#314252");
    drawCracks(ctx, r, b.crackLevel || 0);
  }
  for (const b of room.platforms) drawPlatform(ctx, transformedRect(state, b));
  for (const b of room.cracks) if (!b.broken) drawRect(ctx, transformedRect(state, b), "#774849", "#c87c7d");
  for (const b of room.erode) if (!b.broken) {
    const r = transformedRect(state, b);
    drawRect(ctx, r, `rgba(94,82,50,${0.35 + b.hp * 0.55})`, "#bda366");
    drawCracks(ctx, r, b.crackLevel || 0);
    ctx.fillStyle = "#15130f";
    ctx.fillRect(r.x + 6, r.y + 6, (r.w - 12) * Math.max(0, b.hp), 4);
  }
  for (const b of room.hidden) {
    const r = transformedRect(state, b);
    if (!rectsOverlap(player, r)) drawRect(ctx, r, "#607487", "#314252");
  }
  for (const b of room.breakablePlatforms || []) {
    if (b.broken) continue;
    const r = transformedRect(state, b);
    const stress = Math.min(1, b.standTime / 2);
    drawRect(ctx, r, `rgb(${154 + stress * 35},${128 - stress * 35},${101 - stress * 30})`, "#4f4035");
    drawCracks(ctx, r, stress > 0.66 ? 2 : stress > 0.33 ? 1 : 0);
  }
  for (const g of room.gates || []) drawGate(ctx, transformedRect(state, g));
  for (const h of room.hazards || []) if (!h.disabled) drawHazard(ctx, transformedRect(state, h));
  for (const segment of room.lightningSegments || []) drawLightning(ctx, segment, state);
  const lightningDisabled = Boolean(room.lightningDisabled);
  if (!lightningDisabled) {
    for (const node of room.lightningNodes || []) {
      const x = node.face === 1 ? (node.x + 1) * TILE :
        node.face === 3 ? node.x * TILE : node.x * TILE + TILE / 2;
      const y = node.face === 2 ? (node.y + 1) * TILE :
        node.face === 0 ? node.y * TILE : node.y * TILE + TILE / 2;
      const p = rotatePoint(x, y, state.worldRot);
      ctx.fillStyle = state.form === "green" ? "#b8dbc0" : "#64ffad";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const s of room.switches || []) drawSwitch(ctx, s);
  for (const s of room.repeatSwitches || []) drawSwitch(ctx, s);
  for (const s of room.leverSwitches || []) drawLeverSwitch(ctx, s);
  for (const f of room.checkpoints || []) {
    const key = `checkpoint:${room.id}:${f.x},${f.y}`;
    drawCheckpoint(ctx, f, state.checkpoint?.key === key);
  }
  for (const e of room.enemies || []) drawEnemy(ctx, e);
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
  if (state.reachOverlay) drawReachableOverlay(ctx, state);
  for (let i = 1; i < player.graves.length; i += 1) {
    ctx.strokeStyle = state.form === "green" ? "#9fd2ad" : "#53605a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.graves[i - 1].x + 14, player.graves[i - 1].y + 16);
    ctx.lineTo(player.graves[i].x + 14, player.graves[i].y + 16);
    ctx.stroke();
  }
  for (const g of player.graves) drawRect(ctx, { x: g.x, y: g.y, w: 28, h: 32 }, "#617064", "#a4bea8");
  if (room.flag) {
    drawFlag(
      ctx,
      transformedRect(state, room.flag),
      state.raisedFlags.has(room.id),
      room.flagProgress ?? 1,
      state.checkpoint?.key === `flag:${room.id}`
    );
  }
  if (room.helmet && !state.worldRooms[state.roomIndex].helmet.taken) drawHelmet(ctx, room.helmet);
  for (const item of room.abilityPickups || []) if (!item.taken && !state.unlockedForms?.has(item.form)) drawAbility(ctx, item);
  for (const coin of room.coins || []) {
    if (coin.disabled) continue;
    const key = `${room.id}:${coin.x},${coin.y}`;
    if (!state.collectedCoins?.has(key)) drawCoin(ctx, coin);
  }

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
  if (player.rollTimer > 0) {
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.rotate(player.facing * (0.8 - player.rollTimer * 5));
    ctx.fillRect(-player.w / 2, -player.h * 0.35, player.w, player.h * 0.7);
    ctx.restore();
  } else {
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }
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
  if (state.mapOpen) drawVisitedMap(ctx, state);
  ctx.restore();
}

function drawVisitedMap(ctx, state) {
  const visited = [...state.visitedRooms].sort((a, b) => a - b);
  if (!visited.length) return;
  ctx.save();
  ctx.fillStyle = "rgba(16,20,27,0.78)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cardW = 112;
  const cardH = 72;
  const gap = 12;
  const cols = 5;
  const startX = 58;
  const startY = 48;
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i < visited.length; i += 1) {
    const id = visited[i];
    const room = state.worldRooms[id - 1];
    if (!room) continue;
    const x = startX + (i % cols) * (cardW + gap);
    const y = startY + Math.floor(i / cols) * (cardH + gap);
    ctx.fillStyle = id === state.room.id ? "#263649" : "#202b38";
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = id === state.room.id ? "#f4c95d" : "#3b4757";
    ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);
    ctx.fillStyle = "#dfe8ed";
    ctx.fillText(String(id).padStart(2, "0"), x + 6, y + 14);
    const scaleX = (cardW - 12) / COLS;
    const scaleY = (cardH - 24) / ROWS;
    const ox = x + 6;
    const oy = y + 20;
    for (let gy = 0; gy < room.blocks.length; gy += 1) {
      for (let gx = 0; gx < room.blocks[gy].length; gx += 1) {
        const cell = room.blocks[gy][gx];
        if (cell === ".") continue;
        ctx.fillStyle = cell === "!" ? "#9c3038" :
          cell === "~" ? "#8ee6ff" :
            "GRWBC".includes(cell) ? "#f4c95d" :
              cell === "M" ? "#3f273f" :
                cell === "D" ? "#6f7884" :
                  "#607487";
        ctx.fillRect(ox + gx * scaleX, oy + gy * scaleY, Math.max(1, scaleX), Math.max(1, scaleY));
      }
    }
  }
  ctx.restore();
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
    ctx.fillStyle = state.selectedForm === id ? FORMS[id].color : "#596372";
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#10141b";
    ctx.fillText(text, x, y + 8);
  }
  ctx.textAlign = "left";
}

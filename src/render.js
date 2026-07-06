"use strict";

import { FORMS, RED_QTE_READY, RED_QTE_TIME } from "./constants.js";
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
}

function drawSwitch(ctx, s) {
  ctx.fillStyle = s.pressed ? "#74c476" : "#d6c08a";
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = "#314252";
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
}

function drawGate(ctx, g) {
  if (g.open) return;
  drawRect(ctx, g, "#3c4a56", "#f4c95d");
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
  for (const b of room.platforms) drawRect(ctx, transformedRect(state, b), "#758698", "#40505f");
  for (const b of room.cracks) if (!b.broken) drawRect(ctx, transformedRect(state, b), "#774849", "#c87c7d");
  for (const b of room.erode) if (!b.broken) {
    const r = transformedRect(state, b);
    drawRect(ctx, r, `rgba(94,82,50,${0.35 + b.hp * 0.55})`, "#bda366");
    drawCracks(ctx, r, b.crackLevel || 0);
    ctx.fillStyle = "#15130f";
    ctx.fillRect(r.x + 6, r.y + 6, (r.w - 12) * Math.max(0, b.hp), 4);
  }
  for (const b of room.hidden) {
    if (isGreenAfterimage(state)) drawRect(ctx, transformedRect(state, b), "rgba(127,160,131,0.6)", "#b8dbc0");
  }
  for (const g of room.gates || []) drawGate(ctx, transformedRect(state, g));
  for (const h of room.hazards || []) drawHazard(ctx, transformedRect(state, h));
  for (const s of room.switches || []) drawSwitch(ctx, s);
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
  for (const item of room.abilityPickups || []) if (!item.taken && !state.unlockedForms?.has(item.form)) drawAbility(ctx, item);

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

"use strict";

import {
  BLACK_GRAVITY, BLACK_JUMP, COLS, FORMS, GRAVITY, GREEN_GRAVITY, GREEN_JUMP, GREEN_MOVE,
  HEIGHT, JUMP, MOVE, RED_DASH_DISTANCE, RED_QTE_READY, RED_QTE_TIME, ROWS, TILE, WIDTH,
  WHITE_HOOK_RANGE, WHITE_PLAGUE_SPEED, WHITE_SURFACE_SPEED,
} from "./constants.js";
import { transformedRect, transformedPoint, transformedPlague, isGreenAfterimage, rotatePoint } from "./physics.js";

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

function drawEmitter(ctx, emitter, state) {
  if (emitter.disabled) return;
  const r = transformedRect(state, emitter);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  ctx.fillStyle = "#ff8a5c";
  ctx.strokeStyle = "#3a1e18";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#ffcf9a";
  const direction = emitterDirection(emitter);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + direction.x * 16, cy + direction.y * 16);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function emitterDirection(emitter) {
  const mode = emitter.directionMode || emitter.direction || "vector";
  if (mode === "up") return { x: 0, y: -1 };
  if (mode === "down") return { x: 0, y: 1 };
  if (mode === "left") return { x: -1, y: 0 };
  if (mode === "right") return { x: 1, y: 0 };
  if (mode === "facing" && Array.isArray(emitter.path) && emitter.path.length) {
    const target = emitter.path[emitter.pathIndex % emitter.path.length];
    if (target) {
      const cx = emitter.x + emitter.w / 2;
      const cy = emitter.y + emitter.h / 2;
      const dx = target.x - cx;
      const dy = target.y - cy;
      const length = Math.hypot(dx, dy);
      if (length > 0.001) return { x: dx / length, y: dy / length };
    }
  }
  return { x: Number(emitter.dx || 1), y: Number(emitter.dy || 0) };
}

function drawProjectile(ctx, projectile) {
  ctx.fillStyle = projectile.hazard === "lightning" ? "#35f28a" :
    projectile.hazard === "plague" ? "#dff2d2" : "#9c3038";
  ctx.strokeStyle = "#151820";
  if (projectile.hazard === "spike") {
    ctx.beginPath();
    ctx.moveTo(projectile.x, projectile.y + projectile.h);
    ctx.lineTo(projectile.x + projectile.w / 2, projectile.y);
    ctx.lineTo(projectile.x + projectile.w, projectile.y + projectile.h);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.arc(projectile.x + projectile.w / 2, projectile.y + projectile.h / 2, projectile.w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawFallingObject(ctx, object) {
  if (object.kind === "platform" || object.kind === "breakable") {
    drawRect(ctx, object, object.kind === "breakable" ? "#9a8065" : "#7da7bd", object.kind === "breakable" ? "#4f4035" : "#2e6f88");
    return;
  }
  if (object.kind === "wall") {
    drawRect(ctx, object, "#607487", "#314252");
    return;
  }
  if (object.kind === "spike") {
    drawHazard(ctx, object);
    return;
  }
  if (object.kind === "enemy") {
    drawEnemy(ctx, { ...object, alive: true, advanced: false });
    return;
  }
  if (object.kind === "coin") {
    drawCoin(ctx, object);
    return;
  }
  if (object.kind === "anchor") {
    ctx.fillStyle = "#f4c95d";
    ctx.beginPath();
    ctx.arc(object.x + object.w / 2, object.y + object.h / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (object.kind === "lightning") {
    ctx.strokeStyle = "#35f28a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(object.x + 10, object.y + object.h / 2);
    ctx.lineTo(object.x + object.w - 10, object.y + object.h / 2);
    ctx.stroke();
    ctx.fillStyle = "#35f28a";
    ctx.beginPath();
    ctx.arc(object.x + 10, object.y + object.h / 2, 4, 0, Math.PI * 2);
    ctx.arc(object.x + object.w - 10, object.y + object.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = "#dff2d2";
  ctx.beginPath();
  ctx.ellipse(object.x + object.w / 2, object.y + object.h / 2, object.w * 0.42, object.h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDropBoss(ctx, boss) {
  if (boss.defeated) return;
  ctx.save();
  const paused = (boss.pauseTimer || 0) > 0;
  const hit = (boss.hitCooldown || 0) > 0;
  ctx.fillStyle = boss.enabled === false ? "#3b3340" : hit ? "#7b3f5d" : "#49364f";
  ctx.strokeStyle = paused ? "#9fb0c2" : "#f4c95d";
  ctx.lineWidth = 3;
  ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
  ctx.strokeRect(boss.x + 0.5, boss.y + 0.5, boss.w - 1, boss.h - 1);
  ctx.fillStyle = "#f4c95d";
  ctx.fillRect(boss.x + boss.w * 0.28, boss.y + boss.h * 0.34, boss.w * 0.08, boss.h * 0.08);
  ctx.fillRect(boss.x + boss.w * 0.64, boss.y + boss.h * 0.34, boss.w * 0.08, boss.h * 0.08);
  const maxHp = Math.max(1, boss.maxHp || 8);
  const hp = Math.max(0, Math.min(maxHp, boss.hp ?? maxHp));
  const gap = 3;
  const barX = boss.x + 12;
  const barY = boss.y - 12;
  const barW = Math.max(24, boss.w - 24);
  const tickW = Math.max(3, (barW - gap * (maxHp - 1)) / maxHp);
  ctx.fillStyle = "#151820";
  ctx.fillRect(barX, barY, barW, 7);
  for (let i = 0; i < maxHp; i += 1) {
    ctx.fillStyle = i < hp ? "#d34b4b" : "#4a4148";
    ctx.fillRect(barX + i * (tickW + gap), barY + 1, tickW, 5);
  }
  ctx.restore();
  for (const warning of boss.warnings || []) {
    const ratio = Math.max(0, Math.min(1, warning.timer / (warning.duration || 1)));
    const width = warning.kind === "lightning" ? TILE * 2 : TILE;
    ctx.save();
    ctx.fillStyle = `rgba(244, 201, 93, ${0.12 + (1 - ratio) * 0.2})`;
    ctx.strokeStyle = "#f4c95d";
    ctx.lineWidth = 2;
    ctx.fillRect(warning.x + 2, warning.y + 2, width - 4, TILE - 4);
    ctx.strokeRect(warning.x + 1.5, warning.y + 1.5, width - 3, TILE - 3);
    ctx.restore();
  }
}

function transformedRouteBoss(state, boss) {
  const out = { ...boss };
  if (boss.parts?.length) out.parts = boss.parts.map((part) => transformedRect(state, part));
  else {
    const body = transformedRect(state, boss);
    out.x = body.x;
    out.y = body.y;
    out.w = body.w;
    out.h = body.h;
  }
  out.warningRects = (boss.warningRects || []).map((rect) => transformedRect(state, rect));
  return out;
}

function drawRouteBoss(ctx, boss) {
  if (boss.defeated) return;
  for (const warning of boss.warningRects || []) {
    ctx.save();
    ctx.fillStyle = "rgba(244, 201, 93, 0.18)";
    ctx.strokeStyle = "#f4c95d";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.fillRect(warning.x, warning.y, warning.w, warning.h);
    ctx.strokeRect(warning.x + 0.5, warning.y + 0.5, warning.w - 1, warning.h - 1);
    ctx.restore();
  }
  const parts = boss.parts?.length ? boss.parts : [boss];
  for (const part of parts) {
    ctx.save();
    const dark = boss.phase === "darkShoot";
    ctx.fillStyle = dark ? "#1b1824" : boss.split ? "#5a385f" : "#59415f";
    ctx.strokeStyle = dark ? "#9e7bd1" : "#f4c95d";
    ctx.lineWidth = 3;
    ctx.fillRect(part.x, part.y, part.w, part.h);
    ctx.strokeRect(part.x + 0.5, part.y + 0.5, part.w - 1, part.h - 1);
    ctx.fillStyle = "#f4c95d";
    ctx.fillRect(part.x + part.w * 0.26, part.y + part.h * 0.32, Math.max(5, part.w * 0.08), Math.max(5, part.h * 0.08));
    ctx.fillRect(part.x + part.w * 0.64, part.y + part.h * 0.32, Math.max(5, part.w * 0.08), Math.max(5, part.h * 0.08));
    if (boss.phase === "shoot" || boss.phase === "darkShoot") {
      ctx.strokeStyle = "#ffcf9a";
      ctx.lineWidth = 2;
      const cy = part.y + part.h * 0.5;
      ctx.beginPath();
      ctx.moveTo(part.x + part.w * 0.25, cy);
      ctx.lineTo(part.x + part.w * 0.05, cy);
      ctx.moveTo(part.x + part.w * 0.75, cy);
      ctx.lineTo(part.x + part.w * 0.95, cy);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFinalBoss(ctx, boss, state) {
  if (boss.defeated) return;
  ctx.save();
  const phase2 = boss.phase >= 2;
  if (!phase2) drawFinalBossQuadrantFields(ctx, boss, state);
  const flash = Math.max(0, Math.min(1, boss.skillFlashTimer || 0));
  const plagueWindup = phase2 && !(boss.plagueActiveTimer > 0) ? Math.max(0, Math.min(1, (2 - (boss.plagueTimer ?? 99)) / 2)) : 0;
  const lightningWindup = phase2 ? Math.max(0, Math.min(1, (2 - (boss.lightningTimer ?? 99)) / 2)) : 0;
  ctx.save();
  if (plagueWindup > 0) {
    ctx.translate(boss.x + boss.w / 2, boss.y + boss.h / 2);
    ctx.rotate(performance.now() * 0.012 * (1 + plagueWindup * 3));
    ctx.translate(-boss.x - boss.w / 2, -boss.y - boss.h / 2);
  }
  ctx.fillStyle = phase2 ? "#8a1dff" : "#b000ff";
  ctx.strokeStyle = phase2 ? "#ff4fd8" : "#ffe600";
  ctx.lineWidth = 4 + plagueWindup * 3;
  ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
  ctx.strokeRect(boss.x + 1, boss.y + 1, boss.w - 2, boss.h - 2);
  if (plagueWindup > 0) {
    ctx.strokeStyle = `rgba(213,255,0,${0.25 + plagueWindup * 0.55})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(boss.x + 10, boss.y + boss.h / 2);
    ctx.lineTo(boss.x + boss.w - 10, boss.y + boss.h / 2);
    ctx.moveTo(boss.x + boss.w / 2, boss.y + 10);
    ctx.lineTo(boss.x + boss.w / 2, boss.y + boss.h - 10);
    ctx.stroke();
  }
  ctx.restore();
  if (lightningWindup > 0) {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() * 0.025));
    ctx.strokeStyle = `rgba(0,255,106,${pulse})`;
    ctx.lineWidth = 5 + lightningWindup * 5;
    ctx.strokeRect(boss.x - 6, boss.y - 6, boss.w + 12, boss.h + 12);
  }
  if (flash > 0) {
    const cx = boss.x + boss.w / 2;
    const cy = boss.y + boss.h / 2;
    const radius = Math.max(boss.w, boss.h) / 2 + (1 - flash) * TILE * 2.4;
    ctx.strokeStyle = boss.skillMode === "pull" ? `rgba(255,230,0,${flash})` : `rgba(0,229,255,${flash})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  if ((boss.plagueActiveTimer || 0) > 0) {
    ctx.fillStyle = "rgba(213,255,0,0.52)";
    ctx.fillRect(boss.x + 5, boss.y + 5, boss.w - 10, boss.h - 10);
  }
  const weak = finalBossWeakRect(boss);
  if (weak) {
    ctx.fillStyle = "#00ff6a";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fillRect(weak.x, weak.y, weak.w, weak.h);
    ctx.strokeRect(weak.x + 0.5, weak.y + 0.5, weak.w - 1, weak.h - 1);
  }
  const maxHp = Math.max(1, boss.maxHp || 28);
  const hp = Math.max(0, Math.min(maxHp, boss.hp ?? maxHp));
  ctx.fillStyle = "#151820";
  ctx.fillRect(boss.x, boss.y - 14, boss.w, 8);
  ctx.fillStyle = phase2 ? "#ff4fd8" : "#ff1744";
  ctx.fillRect(boss.x, boss.y - 14, boss.w * (hp / maxHp), 8);
  if (!phase2) drawFinalBossBodyQuadrants(ctx, boss);
  for (const warning of boss.lightningWarnings || []) {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() * 0.03));
    ctx.strokeStyle = `rgba(0,255,106,${pulse})`;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2 + pulse * 3;
    ctx.strokeRect(warning.x - TILE / 2, warning.y - TILE / 2, TILE, TILE);
    ctx.setLineDash([]);
  }
  for (const line of boss.temporaryLightning || []) {
    ctx.strokeStyle = "#00ff6a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(line.ax, line.ay);
    ctx.lineTo(line.bx, line.by);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFinalBossQuadrantFields(ctx, boss, state) {
  if (!boss.quadrantBans?.length) return;
  const colors = { red: "#ff1744", green: "#00e676", white: "#ffea00", black: "#7c4dff" };
  const cx = boss.x + boss.w / 2;
  const cy = boss.y + boss.h / 2;
  const width = state.room?.width || state.room?.cols * TILE || ctx.canvas.width;
  const height = state.room?.height || state.room?.rows * TILE || ctx.canvas.height;
  const quadrants = [
    { x: 0, y: 0, w: cx, h: cy },
    { x: cx, y: 0, w: width - cx, h: cy },
    { x: 0, y: cy, w: cx, h: height - cy },
    { x: cx, y: cy, w: width - cx, h: height - cy },
  ];
  ctx.save();
  for (let i = 0; i < quadrants.length; i += 1) {
    const ban = boss.quadrantBans[i];
    const q = quadrants[i];
    if (!ban || q.w <= 0 || q.h <= 0) continue;
    ctx.fillStyle = `${colors[ban] || "#ffffff"}2e`;
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.strokeStyle = `${colors[ban] || "#ffffff"}aa`;
    ctx.lineWidth = 2;
    ctx.strokeRect(q.x + 1, q.y + 1, q.w - 2, q.h - 2);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.48)";
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.moveTo(0, cy);
  ctx.lineTo(width, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function finalBossWeakRect(boss) {
  const size = 22;
  const side = boss.weakSide || "top";
  if (side === "top") return { x: boss.x + boss.w / 2 - size / 2, y: boss.y - size * 0.4, w: size, h: size };
  if (side === "right") return { x: boss.x + boss.w - size * 0.6, y: boss.y + boss.h / 2 - size / 2, w: size, h: size };
  if (side === "bottom") return { x: boss.x + boss.w / 2 - size / 2, y: boss.y + boss.h - size * 0.6, w: size, h: size };
  return { x: boss.x - size * 0.4, y: boss.y + boss.h / 2 - size / 2, w: size, h: size };
}

function drawFinalBossBodyQuadrants(ctx, boss) {
  const colors = { red: "#ff1744", green: "#00e676", white: "#ffea00", black: "#7c4dff" };
  const quadrants = [
    { x: boss.x, y: boss.y, w: boss.w / 2, h: boss.h / 2 },
    { x: boss.x + boss.w / 2, y: boss.y, w: boss.w / 2, h: boss.h / 2 },
    { x: boss.x, y: boss.y + boss.h / 2, w: boss.w / 2, h: boss.h / 2 },
    { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2, w: boss.w / 2, h: boss.h / 2 },
  ];
  for (let i = 0; i < quadrants.length; i += 1) {
    const ban = boss.quadrantBans?.[i];
    if (!ban) continue;
    const q = quadrants[i];
    ctx.fillStyle = `${colors[ban] || "#ffffff"}88`;
    ctx.fillRect(q.x + 4, q.y + 4, q.w - 8, q.h - 8);
    ctx.strokeStyle = colors[ban] || "#ffffff";
    ctx.strokeRect(q.x + 4.5, q.y + 4.5, q.w - 9, q.h - 9);
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
  const fill = p.moving ? "#7da7bd" : "#758698";
  const stroke = p.moving ? "#2e6f88" : "#40505f";
  drawRect(ctx, p, fill, stroke);
  if (p.moving && p.path?.length) {
    ctx.save();
    ctx.strokeStyle = "rgba(46,111,136,0.45)";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    p.path.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    if (p.loop && p.path.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawGate(ctx, g) {
  const amount = Math.max(0, Math.min(1, g.openAmount || 0));
  if (amount >= 0.99) return;
  const h = g.h * (1 - amount);
  drawRect(ctx, { ...g, y: g.y + (g.h - h) / 2, h }, `rgba(60,74,86,${1 - amount * 0.7})`, "#f4c95d");
}

function drawBoss(ctx, boss) {
  ctx.save();
  const flash = boss.hitFlash > 0;
  ctx.fillStyle = flash ? "#fff3cf" : boss.state === "aim" ? "#c05252" : "#49364f";
  ctx.strokeStyle = "#17121c";
  ctx.lineWidth = 4;
  ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
  ctx.strokeRect(boss.x + 2, boss.y + 2, boss.w - 4, boss.h - 4);
  ctx.fillStyle = "#ffcf68";
  ctx.fillRect(boss.x + 19, boss.y + 28, 12, 10);
  ctx.fillRect(boss.x + boss.w - 31, boss.y + 28, 12, 10);
  ctx.fillStyle = "#151820";
  const maxHp = Math.max(1, boss.maxHp || 1);
  const gap = 4;
  const barX = boss.x + 16;
  const barW = boss.w - 32;
  const tickW = Math.max(3, (barW - gap * (maxHp - 1)) / maxHp);
  ctx.fillRect(barX, boss.y - 14, barW, 7);
  for (let i = 0; i < maxHp; i += 1) {
    ctx.fillStyle = i < boss.hp ? "#d34b4b" : "#4a4148";
    ctx.fillRect(barX + i * (tickW + gap), boss.y - 13, tickW, 5);
  }
  if (boss.state === "aim") {
    ctx.strokeStyle = "rgba(217,91,66,0.85)";
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(boss.x + boss.w / 2, boss.y + boss.h / 2);
    ctx.lineTo(boss.x + boss.w / 2 + (boss.aimX || 0) * TILE * 18, boss.y + boss.h / 2 + (boss.aimY || 0) * TILE * 18);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawLightning(ctx, segment, state) {
  if (segment.disabled) return;
  const a = rotatePoint(segment.ax, segment.ay, state.worldRot);
  const b = rotatePoint(segment.bx, segment.by, state.worldRot);
  ctx.save();
  ctx.strokeStyle = "#35f28a";
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
  const min = Math.min(segment.a, segment.b);
  const max = Math.max(segment.a, segment.b);
  const start = Math.floor(min / step) * step;
  const end = max;
  for (let t = start; t <= end; t += step) {
    if (t < min) continue;
    const seed = segment.seed * 97 + Math.round(t);
    const jitter = ((seed * 13) % 7) - 3;
    const sampleT = Math.max(min, Math.min(max, t + jitter));
    const len = 16 + (seed % 5) * 3;
    const thick = segment.thick + (seed % 3);
    const outward = segment.playerGenerated ? 6 : 0;
    const x = segment.tx * sampleT + segment.nx * segment.n + segment.nx * outward;
    const y = segment.ty * sampleT + segment.ny * segment.n + segment.ny * outward;
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
  const camera = roomCamera(room, player, ctx.canvas);
  ctx.save();
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.x, -camera.y);

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
  for (const zone of room.gravityZones || []) {
    const r = transformedRect(state, zone);
    ctx.fillStyle = "rgba(109, 183, 255, 0.16)";
    ctx.strokeStyle = "rgba(109, 183, 255, 0.55)";
    ctx.setLineDash([8, 5]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.setLineDash([]);
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
  for (const emitter of room.emitters || []) drawEmitter(ctx, emitter, state);
  for (const projectile of room.projectiles || []) drawProjectile(ctx, transformedRect(state, projectile));
  for (const object of room.fallingObjects || []) if (!object.dead) drawFallingObject(ctx, transformedRect(state, object));
  for (const boss of room.bosses || []) drawBoss(ctx, transformedRect(state, boss));
  for (const boss of room.dropBosses || []) drawDropBoss(ctx, transformedRect(state, boss));
  for (const boss of room.routeBosses || []) drawRouteBoss(ctx, transformedRouteBoss(state, boss));
  for (const boss of room.finalBosses || []) drawFinalBoss(ctx, transformedRect(state, boss), state);
  for (const segment of room.lightningSegments || []) drawLightning(ctx, segment, state);
  const lightningDisabled = Boolean(room.lightningDisabled);
  if (!lightningDisabled) {
    for (const node of room.lightningNodes || []) {
      const x = node.face === 1 ? (node.x + 1) * TILE :
        node.face === 3 ? node.x * TILE : node.x * TILE + TILE / 2;
      const y = node.face === 2 ? (node.y + 1) * TILE :
        node.face === 0 ? node.y * TILE : node.y * TILE + TILE / 2;
      const p = rotatePoint(x, y, state.worldRot);
      ctx.fillStyle = "#64ffad";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const s of room.switches || []) {
    if (room.bossRoom && s.switchKey === "8,38" && !room.bossDefeated) continue;
    if (isRoom22DropBossSwitchHidden(room)) continue;
    drawSwitch(ctx, transformedRect(state, s));
  }
  for (const s of room.repeatSwitches || []) drawSwitch(ctx, transformedRect(state, s));
  for (const s of room.leverSwitches || []) drawLeverSwitch(ctx, transformedRect(state, s));
  for (const f of room.checkpoints || []) {
    const key = `checkpoint:${room.id}:${f.x},${f.y}`;
    drawCheckpoint(ctx, transformedRect(state, f), state.checkpoint?.key === key);
  }
  for (const e of room.enemies || []) drawEnemy(ctx, transformedRect(state, e));
  for (const a of room.anchors) {
    const point = transformedPoint(state, a);
    ctx.fillStyle = "#f4f2e6";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of room.plagueHazards) {
    if (p.disabled) continue;
    drawPlagueStain(ctx, transformedPlague(state, p), 1);
  }
  for (const p of player.plague) {
    drawPlagueStain(ctx, p, 0.82);
  }
  if (state.reachOverlay) drawReachableOverlay(ctx, state);
  for (let i = 1; i < player.graves.length; i += 1) {
    ctx.strokeStyle = "#35f28a";
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
  if (room.helmet && !state.worldRooms[state.roomIndex].helmet.taken) drawHelmet(ctx, transformedRect(state, room.helmet));
  for (const item of room.abilityPickups || []) if (!item.taken && !state.unlockedForms?.has(item.form)) drawAbility(ctx, transformedRect(state, item));
  for (const coin of room.coins || []) {
    if (coin.disabled) continue;
    const key = `${room.id}:${coin.x},${coin.y}`;
    if (!state.collectedCoins?.has(key)) drawCoin(ctx, transformedRect(state, coin));
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
  let playerDrawn = false;
  if (state.deathTimer > 0) {
    drawPlayerDeath(ctx, state);
    playerDrawn = true;
  } else if (player.rollTimer > 0) {
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.rotate(player.facing * (0.8 - player.rollTimer * 5));
    ctx.fillRect(-player.w / 2, -player.h * 0.35, player.w, player.h * 0.7);
    ctx.restore();
  } else if (state.form === "white" && Number.isFinite(player.whiteAngle)) {
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.rotate(player.whiteAngle);
    ctx.fillRect(-player.w / 2, -player.h / 2, player.w, player.h);
    ctx.strokeStyle = "rgba(17,25,35,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-player.w / 2 + 0.5, -player.h / 2 + 0.5, player.w - 1, player.h - 1);
    if (player.plagueGrace > 0) {
      ctx.strokeStyle = "rgba(244,242,230,0.75)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-player.w / 2 - 3, -player.h / 2 - 3, player.w + 6, player.h + 6);
    }
    ctx.fillStyle = "#111923";
    ctx.fillRect(-player.w / 2 + 6, -player.h / 2 + 9, 4, 4);
    ctx.fillRect(-player.w / 2 + 15, -player.h / 2 + 9, 4, 4);
    ctx.restore();
    playerDrawn = true;
  } else {
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }
  if (!playerDrawn) {
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
  }
  ctx.restore();

  drawRouteBossDarkness(ctx, state, camera, ctx.canvas);
  drawFinalBossFormFilter(ctx, state, camera, ctx.canvas);
  if (state.deathTimer <= 0) drawRedQte(ctx, player);
  ctx.restore();
  if (state.form === "black") {
    ctx.fillStyle = "#d6c08a";
    ctx.font = "700 20px Microsoft YaHei, sans-serif";
    ctx.fillText(["→", "↓", "←", "↑"][state.worldRot], 24, 34);
  }
  drawGravityZoneTimer(ctx, state);
  drawFinalBossForbiddenTimer(ctx, state);
  if (state.choosing) drawChoiceOverlay(ctx, state);
  if (state.mapOpen) drawVisitedMap(ctx, state);
  ctx.restore();
}

function isRoom22DropBossSwitchHidden(room) {
  return Boolean(room?.dropBosses?.some((boss) => !boss.defeated));
}

function drawGravityZoneTimer(ctx, state) {
  if (!state.wasInGravityZone && !(state.zoneInvincibleTimer > 0)) return;
  const time = state.wasInGravityZone ? state.gravityZoneTime || 0 : 0;
  const invincible = Math.max(0, state.zoneInvincibleTimer || 0);
  const text = state.wasInGravityZone
    ? `低重力 ${time.toFixed(1)}s${invincible > 0 ? `  无敌 ${invincible.toFixed(1)}s` : ""}`
    : `无敌 ${invincible.toFixed(1)}s`;
  ctx.save();
  ctx.font = "700 18px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const x = ctx.canvas.width / 2;
  const y = 14;
  const metrics = ctx.measureText(text);
  const w = metrics.width + 28;
  ctx.fillStyle = "rgba(18, 31, 44, 0.78)";
  ctx.strokeStyle = invincible > 0 ? "#f4c95d" : "#6db7ff";
  ctx.lineWidth = 2;
  ctx.fillRect(x - w / 2, y - 4, w, 32);
  ctx.strokeRect(x - w / 2 + 0.5, y - 3.5, w - 1, 31);
  ctx.fillStyle = invincible > 0 ? "#f4c95d" : "#d7ecff";
  ctx.fillText(text, x, y + 3);
  ctx.restore();
}

function drawFinalBossForbiddenTimer(ctx, state) {
  if (!(state.finalBossForbiddenTimer > 0) || !state.finalBossForbiddenForm) return;
  const timer = Math.max(0, state.finalBossForbiddenTimer);
  const label = FORMS[state.finalBossForbiddenForm]?.name || state.finalBossForbiddenForm;
  const cx = ctx.canvas.width / 2;
  ctx.save();
  ctx.fillStyle = "rgba(255,23,68,0.9)";
  ctx.fillRect(cx - 150, 54, 300, 42);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 149, 55, 298, 40);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 18px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${label}禁用：${timer.toFixed(1)}秒`, cx, 81);
  ctx.restore();
}

function drawRouteBossDarkness(ctx, state, camera, canvas) {
  const active = state.room?.routeBosses?.some((boss) => !boss.defeated && boss.phase === "darkShoot");
  if (!active) return;
  const { player } = state;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const radius = TILE * 2.5;
  const viewW = canvas.width / camera.scale;
  const viewH = canvas.height / camera.scale;
  ctx.save();
  ctx.fillStyle = "rgba(5, 7, 12, 0.88)";
  ctx.beginPath();
  ctx.rect(camera.x, camera.y, viewW, viewH);
  ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  ctx.restore();
}

function drawFinalBossFormFilter(ctx, state, camera, canvas) {
  const boss = state.room?.finalBosses?.find((item) => !item.defeated && item.phase >= 2 && item.lockedForm);
  if (!boss) return;
  const colors = { red: "232,77,77", green: "127,160,131", white: "244,242,230", black: "37,38,50" };
  const rgb = colors[boss.lockedForm] || "244,201,93";
  ctx.save();
  ctx.fillStyle = `rgba(${rgb},0.18)`;
  ctx.fillRect(camera.x, camera.y, canvas.width / camera.scale, canvas.height / camera.scale);
  ctx.restore();
}

function drawPlayerDeath(ctx, state) {
  const { player } = state;
  const t = Math.max(0, Math.min(1, 1 - state.deathTimer));
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const base = state.form === "green" && !isGreenAfterimage(state) ? "#56735c" : FORMS[state.form].color;
  ctx.save();
  ctx.globalAlpha = 1 - t * 0.75;
  ctx.translate(cx, cy);
  ctx.rotate((player.facing || 1) * t * Math.PI * 1.6);
  const scale = Math.max(0.18, 1 - t * 0.72);
  ctx.scale(scale, scale);
  ctx.fillStyle = base;
  ctx.fillRect(-player.w / 2, -player.h / 2, player.w, player.h);
  ctx.strokeStyle = "rgba(17,25,35,0.7)";
  ctx.strokeRect(-player.w / 2 + 0.5, -player.h / 2 + 0.5, player.w - 1, player.h - 1);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t);
  const fragments = [
    [-1, -0.6], [1, -0.7], [-0.8, 0.7], [0.9, 0.55], [0, -1],
  ];
  ctx.fillStyle = base;
  for (let i = 0; i < fragments.length; i += 1) {
    const [dx, dy] = fragments[i];
    const size = Math.max(3, 7 - t * 3);
    ctx.fillRect(cx + dx * t * 34 - size / 2, cy + dy * t * 28 - size / 2, size, size);
  }
  ctx.restore();
}

function roomCamera(room, player, canvas) {
  if (!room || room.width <= WIDTH && room.height <= HEIGHT) return { x: 0, y: 0, scale: 1 };
  const targetTiles = room.width > WIDTH || room.height > HEIGHT ? 30 : 20;
  const scale = Math.min(canvas.width / (targetTiles * TILE), canvas.height / (targetTiles * TILE), 1);
  const viewW = canvas.width / scale;
  const viewH = canvas.height / scale;
  return {
    x: Math.max(0, Math.min(room.width - viewW, player.x + player.w / 2 - viewW / 2)),
    y: Math.max(0, Math.min(room.height - viewH, player.y + player.h / 2 - viewH / 2)),
    scale,
  };
}

function drawVisitedMap(ctx, state) {
  const visited = [...state.visitedRooms].sort((a, b) => a - b);
  if (!visited.length) return;
  ctx.save();
  ctx.fillStyle = "rgba(16,20,27,0.78)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cardW = 116;
  const cardH = 104;
  const gap = 12;
  const cols = 5;
  const startX = 58;
  const startY = 48;
  const layout = mapLayoutForVisited(state, visited, startX, startY);
  const pan = state.mapPan || { x: 0, y: 0 };
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.textAlign = "left";
  for (let i = 0; i < visited.length; i += 1) {
    const id = visited[i];
    const room = state.worldRooms[state.roomIndexById.get(id)];
    if (!room) continue;
    const scale = mapRoomScale(room);
    const w = cardW * scale;
    const h = cardH * scale;
    const fallback = { x: startX + (i % cols) * (cardW + gap), y: startY + Math.floor(i / cols) * (cardH + gap) };
    const position = layout.get(id) || fallback;
    const x = position.x + pan.x;
    const y = position.y + pan.y;
    if (x > ctx.canvas.width || y > ctx.canvas.height || x + w < 0 || y + h < 0) continue;
    ctx.fillStyle = id === state.room.id ? "#263649" : "#202b38";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = id === state.room.id ? "#f4c95d" : "#3b4757";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#dfe8ed";
    ctx.fillText(String(id).padStart(2, "0"), x + 6, y + 14);
    const roomCols = Math.max(1, room.blocks[0]?.length || COLS);
    const roomRows = Math.max(1, room.blocks.length || ROWS);
    const scaleX = (w - 12) / roomCols;
    const scaleY = (h - 24) / roomRows;
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

function mapRoomScale(room) {
  return Number(room?.roomSize) === 40 ? 2 : 1;
}

function mapLayoutForVisited(state, visited, startX, startY) {
  const out = new Map();
  const positioned = visited
    .map((id) => ({
      id,
      ...(state.mapPositions?.[String(id)] || {}),
    }))
    .filter((room) => Number.isFinite(room.x) && Number.isFinite(room.y));
  if (!positioned.length) return out;

  const minX = Math.min(...positioned.map((room) => room.x));
  const minY = Math.min(...positioned.map((room) => room.y));

  for (const room of positioned) {
    out.set(room.id, {
      x: startX + room.x - minX,
      y: startY + room.y - minY,
    });
  }
  return out;
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
    const blocked = state.finalBossBlockedForms?.has?.(id);
    ctx.fillStyle = blocked ? "#2b2f38" : state.selectedForm === id ? FORMS[id].color : "#596372";
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    if (blocked) {
      ctx.strokeStyle = "#ff1744";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 22, y + 22);
      ctx.lineTo(x + 22, y - 22);
      ctx.stroke();
    }
    ctx.fillStyle = "#10141b";
    ctx.fillText(text, x, y + 8);
  }
  if (state.blockedFormTimer > 0 && state.blockedFormFeedback) {
    ctx.fillStyle = "rgba(255,23,68,0.88)";
    ctx.fillRect(cx - 130, cy - 142, 260, 34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 16px Microsoft YaHei, sans-serif";
    ctx.fillText(`${FORMS[state.blockedFormFeedback]?.name || ""} 禁用`, cx, cy - 119);
  }
  ctx.textAlign = "left";
}

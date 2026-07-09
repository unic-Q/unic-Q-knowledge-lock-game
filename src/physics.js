"use strict";

import { CENTER, WHITE_SNAP } from "./constants.js";

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rotatePoint(x, y, turns) {
  let px = x - CENTER.x;
  let py = y - CENTER.y;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) {
    const nx = -py;
    const ny = px;
    px = nx;
    py = ny;
  }
  return { x: px + CENTER.x, y: py + CENTER.y };
}

export function transformedRect(state, block) {
  const sink = block.sink || 0;
  if (state.worldRot === 0) {
    return sink ? { ...block, y: block.y + sink } : block;
  }
  const c = rotatePoint(block.x + block.w / 2, block.y + block.h / 2, state.worldRot);
  return { ...block, x: c.x - block.w / 2, y: c.y - block.h / 2 + sink };
}

export function isGreenAfterimage(state) {
  return state.form === "green" && state.player.greenAfterimage;
}

export function activeBlocks(state) {
  const out = [];
  const { room, player } = state;
  for (const b of room.blocks) if (!b.broken) out.push(transformedRect(state, b));
  for (const b of room.cracks) if (!b.broken) out.push(transformedRect(state, b));
  for (const b of room.erode) if (!b.broken) out.push(transformedRect(state, b));
  for (const b of room.breakablePlatforms || []) if (!b.broken) out.push(transformedRect(state, b));
  for (const b of room.gates || []) if (!b.open) out.push(transformedRect(state, b));
  if (state.form !== "green") {
    for (const g of player.graves) out.push({ x: g.x, y: g.y, w: 28, h: 32 });
  }
  return out;
}

export function isGroundedNow(state) {
  const { player, room } = state;
  const foot = { x: player.x + 3, y: player.y + player.h, w: player.w - 6, h: 3 };
  if (activeBlocks(state).some((b) => rectsOverlap(foot, b))) return true;
  if (player.dropTimer <= 0) {
    for (const p of room.platforms) {
      if ((p.face || "up") === "up" && rectsOverlap(foot, transformedRect(state, p))) return true;
    }
  }
  return false;
}

export function moveAxis(state, axis, dt) {
  const { player, room } = state;
  const amount = axis === "x" ? player.vx * dt : player.vy * dt;
  player[axis] += amount;
  for (const b of activeBlocks(state)) {
    if (!rectsOverlap(player, b)) continue;
    if (axis === "x") {
      if (amount > 0) player.x = b.x - player.w;
      if (amount < 0) player.x = b.x + b.w;
      player.vx = 0;
    } else if (amount > 0) {
      player.y = b.y - player.h;
      player.vy = 0;
      player.onGround = true;
      player.jumps = 0;
      player.coyote = 0.1;
    } else if (amount < 0) {
      player.y = b.y + b.h;
      player.vy = 0;
    }
  }
  if (axis === "y" && player.dropTimer <= 0 && state.form !== "black") {
    for (const p of room.platforms) {
      const b = transformedRect(state, p);
      const face = p.face || "up";
      const wasAbove = player.y + player.h - amount <= b.y + 2;
      const wasBelow = player.y - amount >= b.y + b.h - 2;
      if (amount >= 0 && face === "up" && wasAbove && rectsOverlap(player, b)) {
        player.y = b.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.jumps = 0;
      } else if (amount < 0 && face === "down" && wasBelow && rectsOverlap(player, b)) {
        player.y = b.y + b.h;
        player.vy = 0;
      }
    }
  }
  if (axis === "x" && state.form !== "black") {
    for (const p of room.platforms) {
      const b = transformedRect(state, p);
      const face = p.face || "up";
      const wasLeft = player.x + player.w - amount <= b.x + 2;
      const wasRight = player.x - amount >= b.x + b.w - 2;
      if (amount > 0 && face === "left" && wasLeft && rectsOverlap(player, b)) {
        player.x = b.x - player.w;
        player.vx = 0;
      } else if (amount < 0 && face === "right" && wasRight && rectsOverlap(player, b)) {
        player.x = b.x + b.w;
        player.vx = 0;
      }
    }
  }
}

export function findWhiteSurface(state) {
  const { player } = state;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  let best = null;
  for (const b of activeBlocks(state)) {
    const faces = [
      { nx: 0, ny: -1, d: Math.abs(player.y + player.h - b.y), ok: cx >= b.x - WHITE_SNAP && cx <= b.x + b.w + WHITE_SNAP },
      { nx: 0, ny: 1, d: Math.abs(player.y - (b.y + b.h)), ok: cx >= b.x - WHITE_SNAP && cx <= b.x + b.w + WHITE_SNAP },
      { nx: -1, ny: 0, d: Math.abs(player.x + player.w - b.x), ok: cy >= b.y - WHITE_SNAP && cy <= b.y + b.h + WHITE_SNAP },
      { nx: 1, ny: 0, d: Math.abs(player.x - (b.x + b.w)), ok: cy >= b.y - WHITE_SNAP && cy <= b.y + b.h + WHITE_SNAP },
    ];
    for (const f of faces) {
      if (!f.ok || f.d > WHITE_SNAP) continue;
      const same = player.whiteSurface && player.whiteSurface.nx === f.nx && player.whiteSurface.ny === f.ny;
      const score = f.d - (same ? 4 : 0);
      if (!best || score < best.score) best = { ...f, score, block: b };
    }
  }
  return best;
}

export function snapWhiteToSurface(player, surface) {
  const b = surface.block;
  if (surface.nx === 0 && surface.ny === -1) player.y = b.y - player.h;
  if (surface.nx === 0 && surface.ny === 1) player.y = b.y + b.h;
  if (surface.nx === -1 && surface.ny === 0) player.x = b.x - player.w;
  if (surface.nx === 1 && surface.ny === 0) player.x = b.x + b.w;
}

export function resolveWhiteOverlap(state) {
  const { player } = state;
  for (const b of activeBlocks(state)) {
    if (!rectsOverlap(player, b)) continue;
    const leftPen = player.x + player.w - b.x;
    const rightPen = b.x + b.w - player.x;
    const topPen = player.y + player.h - b.y;
    const bottomPen = b.y + b.h - player.y;
    const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
    if (minPen === leftPen) return { nx: -1, ny: 0, d: leftPen, block: b };
    if (minPen === rightPen) return { nx: 1, ny: 0, d: rightPen, block: b };
    if (minPen === topPen) return { nx: 0, ny: -1, d: topPen, block: b };
    return { nx: 0, ny: 1, d: bottomPen, block: b };
  }
  return null;
}

export function pointNearSegment(px, py, a, b) {
  const ax = a.x + 14;
  const ay = a.y + 16;
  const bx = b.x + 14;
  const by = b.y + 16;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

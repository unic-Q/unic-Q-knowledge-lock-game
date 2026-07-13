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

export function transformedPoint(state, point) {
  if (state.worldRot === 0) return point;
  return rotatePoint(point.x, point.y, state.worldRot);
}

export function transformedPlague(state, plague) {
  if (state.worldRot === 0 || !Number.isFinite(plague.a) || !Number.isFinite(plague.b)) return plague;
  const tx = plague.tx ?? -plague.ny;
  const ty = plague.ty ?? plague.nx;
  const nx = plague.nx ?? 0;
  const ny = plague.ny ?? -1;
  const p1 = rotatePoint(tx * plague.a + nx * plague.n, ty * plague.a + ny * plague.n, state.worldRot);
  const p2 = rotatePoint(tx * plague.b + nx * plague.n, ty * plague.b + ny * plague.n, state.worldRot);
  const tp = rotateVector(tx, ty, state.worldRot);
  const np = rotateVector(nx, ny, state.worldRot);
  return {
    ...plague,
    a: p1.x * tp.x + p1.y * tp.y,
    b: p2.x * tp.x + p2.y * tp.y,
    n: p1.x * np.x + p1.y * np.y,
    tx: tp.x,
    ty: tp.y,
    nx: np.x,
    ny: np.y,
  };
}

function rotateVector(x, y, turns) {
  let vx = x;
  let vy = y;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) {
    const nx = -vy;
    const ny = vx;
    vx = nx;
    vy = ny;
  }
  return { x: vx, y: vy };
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
  for (const b of room.fallingObjects || []) {
    if (b.dead || !b.solid) continue;
    out.push(transformedRect(state, b));
  }
  for (const b of room.gates || []) if (!b.open) out.push(transformedRect(state, b));
  if (!isGreenAfterimage(state)) {
    for (const g of player.graves) out.push({ x: g.x, y: g.y, w: 28, h: 32 });
  }
  return out;
}

export function whiteSurfaceBlocks(state) {
  const out = [...activeBlocks(state)];
  for (const p of state.room?.platforms || []) {
    if (p.dead) continue;
    out.push(transformedRect(state, p));
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

function stopRedDashOnNormal(state, nx, ny) {
  const dash = state.player.redDash;
  if (state.form !== "red" || !dash) return;
  if (dash.dx * nx + dash.dy * ny < -0.5) state.player.redDash = null;
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
      stopRedDashOnNormal(state, amount > 0 ? -1 : 1, 0);
    } else if (amount > 0) {
      player.y = b.y - player.h;
      player.vy = 0;
      stopRedDashOnNormal(state, 0, -1);
      player.onGround = true;
      player.jumps = 0;
      player.coyote = 0.1;
    } else if (amount < 0) {
      player.y = b.y + b.h;
      player.vy = 0;
      stopRedDashOnNormal(state, 0, 1);
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
        stopRedDashOnNormal(state, 0, -1);
        player.onGround = true;
        player.jumps = 0;
      } else if (amount < 0 && face === "down" && wasBelow && rectsOverlap(player, b)) {
        player.y = b.y + b.h;
        player.vy = 0;
        stopRedDashOnNormal(state, 0, 1);
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
        stopRedDashOnNormal(state, -1, 0);
      } else if (amount < 0 && face === "right" && wasRight && rectsOverlap(player, b)) {
        player.x = b.x + b.w;
        player.vx = 0;
        stopRedDashOnNormal(state, 1, 0);
      }
    }
  }
}

export function findWhiteSurface(state) {
  const { player } = state;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const footHalf = player.w / 2;
  const bodyHalf = player.h / 2;
  let best = null;
  for (const b of whiteSurfaceBlocks(state)) {
    const faces = [
      { nx: 0, ny: -1, d: Math.abs(cy - (b.y - bodyHalf)), ok: cx >= b.x - footHalf - WHITE_SNAP && cx <= b.x + b.w + footHalf + WHITE_SNAP },
      { nx: 0, ny: 1, d: Math.abs(cy - (b.y + b.h + bodyHalf)), ok: cx >= b.x - footHalf - WHITE_SNAP && cx <= b.x + b.w + footHalf + WHITE_SNAP },
      { nx: -1, ny: 0, d: Math.abs(cx - (b.x - bodyHalf)), ok: cy >= b.y - footHalf - WHITE_SNAP && cy <= b.y + b.h + footHalf + WHITE_SNAP },
      { nx: 1, ny: 0, d: Math.abs(cx - (b.x + b.w + bodyHalf)), ok: cy >= b.y - footHalf - WHITE_SNAP && cy <= b.y + b.h + footHalf + WHITE_SNAP },
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
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const footHalf = player.w / 2;
  const bodyHalf = player.h / 2;
  if (surface.nx === 0) {
    const nextCx = Math.max(b.x - footHalf, Math.min(b.x + b.w + footHalf, cx));
    const edgeY = surface.ny === -1 ? b.y : b.y + b.h;
    player.x = nextCx - player.w / 2;
    player.y = edgeY + surface.ny * bodyHalf - player.h / 2;
  } else {
    const nextCy = Math.max(b.y - footHalf, Math.min(b.y + b.h + footHalf, cy));
    const edgeX = surface.nx === -1 ? b.x : b.x + b.w;
    player.x = edgeX + surface.nx * bodyHalf - player.w / 2;
    player.y = nextCy - player.h / 2;
  }
  player.whiteAngle = Math.atan2(surface.ny, surface.nx) + Math.PI / 2;
}

export function resolveWhiteOverlap(state) {
  const { player } = state;
  for (const b of whiteSurfaceBlocks(state)) {
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

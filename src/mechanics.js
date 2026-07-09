"use strict";

import {
  GRAVITY, MOVE, JUMP, RED_DASH_DISTANCE, RED_DASH_TIME, RED_QTE_TIME, RED_QTE_READY,
  RED_KILL_QTE_BONUS, RED_AIR_GRAVITY_SCALE, ROLL_SPEED, ROLL_UP, ROLL_TIME, GREEN_MOVE, GREEN_JUMP,
  GREEN_GRAVITY, BLACK_JUMP, BLACK_GRAVITY,
  WHITE_SURFACE_SPEED, WHITE_PLAGUE_SPEED, WHITE_HOOK_RANGE, WHITE_HOOK_EXTEND, WHITE_HOOK_PULL, WHITE_HOOK_HOLD,
  WHITE_SNAP, ERODE_RATE, ERODE_FAST, WALL_TOUCH_RANGE,
} from "./constants.js";
import {
  activeBlocks, findWhiteSurface, snapWhiteToSurface, resolveWhiteOverlap, rectsOverlap,
  transformedRect, isGroundedNow, rotatePoint,
} from "./physics.js";

export function updateNone(state, input, dt) {
  const { player } = state;
  player.rollCooldown = Math.max(0, player.rollCooldown - dt);
  player.rollTimer = Math.max(0, player.rollTimer - dt);
  player.sideHazardGrace = Math.max(0, player.sideHazardGrace - dt);
  const touchingLeftWall = activeBlocks(state).some((b) =>
    Math.abs(player.x - (b.x + b.w)) < WALL_TOUCH_RANGE &&
    player.y + player.h > b.y + 4 && player.y < b.y + b.h - 2
  );
  const touchingRightWall = activeBlocks(state).some((b) =>
    Math.abs(player.x + player.w - b.x) < WALL_TOUCH_RANGE &&
    player.y + player.h > b.y + 4 && player.y < b.y + b.h - 2
  );
  const grounded = isGroundedNow(state);
  const hazardWallSide = player.sideHazardGrace > 0 ? player.sideHazardSide : 0;
  if (input.space && !state.helmetOwned && player.rollCooldown <= 0) {
    const dir = input.left ? -1 : input.right ? 1 : player.facing || 1;
    player.rollTimer = ROLL_TIME;
    player.rollCooldown = 0.82;
    if (!grounded && (touchingLeftWall || touchingRightWall || hazardWallSide !== 0)) {
      const wallSide = touchingLeftWall ? -1 : touchingRightWall ? 1 : hazardWallSide;
      const launchDir = -wallSide;
      const diagonalSpeed = ROLL_SPEED / Math.sqrt(2);
      player.facing = launchDir;
      player.vx = launchDir * diagonalSpeed * 2;
      player.vy = -diagonalSpeed;
      player.sideHazardGrace = 0;
    } else {
      player.facing = dir;
      player.vx = dir * ROLL_SPEED;
      player.vy = Math.min(player.vy, -ROLL_UP);
    }
  }
  if (input.left) {
    if (player.rollTimer <= 0) player.vx = -MOVE;
    player.facing = -1;
  } else if (input.right) {
    if (player.rollTimer <= 0) player.vx = MOVE;
    player.facing = 1;
  } else {
    player.vx *= player.rollTimer > 0 ? 0.96 : 0.78;
  }
  const nearWall = touchingLeftWall || touchingRightWall;
  if (nearWall && !player.onGround && (input.left || input.right)) player.vy = Math.min(player.vy, 150);
  if (input.up && player.rollTimer <= 0 && (player.jumps < 2 || player.coyote > 0)) {
    const boost = Math.min(120, Math.max(0, player.vy - 680) * 0.25);
    player.vy = -JUMP - boost;
    player.jumps += 1;
    player.coyote = 0;
    player.onGround = false;
  }
  if (input.down) player.dropTimer = 0.18;
  player.vy += GRAVITY * dt;
}

export function updateWhite(state, input, dt) {
  const { player } = state;
  if (updateWhiteHookPull(state, input.upHeld, dt)) return;

  const surface = findWhiteSurface(state);
  if (surface) {
    const previousSurface = player.whiteSurface;
    const previousBody = { x: player.x, y: player.y, w: player.w, h: player.h, plague: player.plague };
    player.whiteSurface = { nx: surface.nx, ny: surface.ny, block: surface.block };
    snapWhiteToSurface(player, surface);
    const dir = input.right ? 1 : input.left ? -1 : 0;
    const tx = -surface.ny;
    const ty = surface.nx;
    const speed = isWhiteSurfacePlagued(state, previousBody, surface) ? WHITE_PLAGUE_SPEED : WHITE_SURFACE_SPEED;
    player.x += tx * speed * dir * dt;
    player.y += ty * speed * dir * dt;
    const overlapSurface = resolveWhiteOverlap(state);
    const nearbySurface = findWhiteSurface(state);
    const nextSurface = overlapSurface || sameNormalSurface(nearbySurface, surface) || exteriorCornerSurface(player, surface, dir) || nearbySurface;
    if (nextSurface) {
      player.whiteSurface = { nx: nextSurface.nx, ny: nextSurface.ny, block: nextSurface.block };
      snapWhiteToSurface(player, nextSurface);
    }
    player.vx = 0;
    player.vy = 0;
    if (dir !== 0) {
      player.facing = dir;
      if (previousSurface && (previousSurface.nx !== player.whiteSurface.nx || previousSurface.ny !== player.whiteSurface.ny)) {
        addPlagueSegment(previousBody, previousSurface, true);
      }
      addPlagueSegment(previousBody, previousSurface || player.whiteSurface);
      trimPlague(player);
    }
  } else {
    player.whiteSurface = null;
    player.vy += GRAVITY * dt;
    if (input.left) {
      player.vx = -MOVE * 0.4;
      player.facing = -1;
    } else if (input.right) {
      player.vx = MOVE * 0.4;
      player.facing = 1;
    } else {
      player.vx *= 0.82;
    }
  }
  if (input.up) shootWhiteHook(state, input.left ? -1 : input.right ? 1 : 0);
  updateWhiteHookPull(state, input.upHeld, dt);
}

function sameNormalSurface(candidate, surface) {
  if (!candidate || !surface) return null;
  return candidate.nx === surface.nx && candidate.ny === surface.ny ? candidate : null;
}

function exteriorCornerSurface(player, surface, dir) {
  if (!dir) return null;
  const b = surface.block;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;

  if (surface.nx === 0) {
    if (cx > b.x + b.w) return { nx: 1, ny: 0, block: b };
    if (cx < b.x) return { nx: -1, ny: 0, block: b };
  }
  if (surface.ny === 0) {
    if (cy > b.y + b.h) return { nx: 0, ny: 1, block: b };
    if (cy < b.y) return { nx: 0, ny: -1, block: b };
  }
  return null;
}

function normalizeWhiteSurface(surface) {
  if (!surface || !surface.block) return null;
  const face = Number.isInteger(surface.face) ? surface.face : faceFromNormal(surface);
  const normal = normalFromFace(face);
  return { ...surface, face, nx: normal.nx, ny: normal.ny };
}

function isWhiteSurfaceUsable(player, surface) {
  if (!surface) return false;
  const b = surface.block;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const limits = whiteCenterLimits(player, surface);
  const coord = whiteCenterCoord(player, surface);
  if (coord < limits.min - WHITE_SNAP || coord > limits.max + WHITE_SNAP) return false;
  if (surface.face === 0) return Math.abs(cy - (b.y - player.h / 2)) <= WHITE_SNAP;
  if (surface.face === 1) return Math.abs(cx - (b.x + b.w + player.w / 2)) <= WHITE_SNAP;
  if (surface.face === 2) return Math.abs(cy - (b.y + b.h + player.h / 2)) <= WHITE_SNAP;
  return Math.abs(cx - (b.x - player.w / 2)) <= WHITE_SNAP;
}

function faceFromNormal(surface) {
  if (surface.nx === 0 && surface.ny === -1) return 0;
  if (surface.nx === 1 && surface.ny === 0) return 1;
  if (surface.nx === 0 && surface.ny === 1) return 2;
  return 3;
}

function normalFromFace(face) {
  return [
    { nx: 0, ny: -1 },
    { nx: 1, ny: 0 },
    { nx: 0, ny: 1 },
    { nx: -1, ny: 0 },
  ][((face % 4) + 4) % 4];
}

function whiteCenterLimits(player, surface) {
  const b = surface.block;
  if (surface.face === 0 || surface.face === 2) {
    return { min: b.x - player.w / 2, max: b.x + b.w + player.w / 2 };
  }
  return { min: b.y - player.h / 2, max: b.y + b.h + player.h / 2 };
}

function whiteCenterCoord(player, surface) {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  return surface.face === 0 || surface.face === 2 ? cx : cy;
}

function setWhiteCenterCoord(player, surface, coord) {
  const b = surface.block;
  if (surface.face === 0) {
    player.x = coord - player.w / 2;
    player.y = b.y - player.h;
  } else if (surface.face === 1) {
    player.x = b.x + b.w;
    player.y = coord - player.h / 2;
  } else if (surface.face === 2) {
    player.x = coord - player.w / 2;
    player.y = b.y + b.h;
  } else {
    player.x = b.x - player.w;
    player.y = coord - player.h / 2;
  }
}

function placeWhiteOnSurface(player, surface) {
  const limits = whiteCenterLimits(player, surface);
  setWhiteCenterCoord(player, surface, Math.max(limits.min, Math.min(limits.max, whiteCenterCoord(player, surface))));
}

function addPlagueSegment(player, surface, corner = false) {
  if (!surface) return;
  const tx = -surface.ny;
  const ty = surface.nx;
  const contact = contactInterval(player, surface);
  if (!contact) return;

  const pad = corner ? 12 : 4;
  const a = contact.a - pad;
  const b = contact.b + pad;
  const n = surface.nx * contact.x + surface.ny * contact.y;
  const key = `${surface.nx},${surface.ny},${Math.round(n)}`;
  const overlapPad = 10;
  const existing = player.plague.find((p) =>
    p.key === key && !(b < p.a - overlapPad || a > p.b + overlapPad)
  );

  if (existing) {
    existing.a = Math.min(existing.a, a);
    existing.b = Math.max(existing.b, b);
    existing.corner = existing.corner || corner;
    existing.seed = Math.min(existing.seed, player.plague.length);
    return;
  }

  player.plague.push({
    key,
    a,
    b,
    n,
    nx: surface.nx,
    ny: surface.ny,
    tx,
    ty,
    thick: corner ? 14 : 10,
    corner,
    seed: player.plague.length,
    life: 999,
  });
}

function trimPlague(player) {
  const maxLength = 32 * 20;
  let total = player.plague.reduce((sum, p) => sum + Math.abs(p.b - p.a), 0);
  while (total > maxLength && player.plague.length) {
    const first = player.plague[0];
    const len = Math.abs(first.b - first.a);
    const excess = total - maxLength;
    if (excess >= len) {
      player.plague.shift();
      total -= len;
    } else {
      first.a += excess;
      total -= excess;
    }
  }
}

function isWhiteSurfacePlagued(state, playerBody, surface) {
  const contact = contactInterval(playerBody, surface);
  if (!contact) return false;
  const n = surface.nx * contact.x + surface.ny * contact.y;
  const a = Math.min(contact.a, contact.b);
  const b = Math.max(contact.a, contact.b);
  return [...state.player.plague, ...(state.room.plagueHazards || [])].some((p) => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return false;
    if (p.nx !== surface.nx || p.ny !== surface.ny) return false;
    if (Math.abs(p.n - n) > WHITE_SNAP) return false;
    const pa = Math.min(p.a, p.b);
    const pb = Math.max(p.a, p.b);
    return !(b < pa || a > pb);
  });
}

function contactInterval(player, surface) {
  const b = surface.block;
  if (surface.nx === 0) {
    const a = Math.max(player.x, b.x);
    const end = Math.min(player.x + player.w, b.x + b.w);
    if (end - a < 5) return null;
    const y = surface.ny === -1 ? b.y - 1 : b.y + b.h + 1;
    return { a, b: end, x: (a + end) / 2, y };
  }

  const a = Math.max(player.y, b.y);
  const end = Math.min(player.y + player.h, b.y + b.h);
  if (end - a < 5) return null;
  const x = surface.nx === -1 ? b.x - 1 : b.x + b.w + 1;
  return { a, b: end, x, y: (a + end) / 2 };
}

function updateWhiteHookPull(state, upHeld, dt) {
  const { player } = state;
  if (!player.hook || player.hookTime <= 0) return false;
  player.hookTime -= dt;
  if (player.hook.extending) {
    player.hook.progress = Math.min(player.hook.length, player.hook.progress + WHITE_HOOK_EXTEND * dt);
    player.hook.x = player.hook.sx + player.hook.dx * player.hook.progress;
    player.hook.y = player.hook.sy + player.hook.dy * player.hook.progress;
    if (player.hook.progress < player.hook.length) return true;
    player.hook.extending = false;
  }
  if (!player.hook.hit) return false;

  if (!upHeld) {
    player.vx = player.hook.vx || 0;
    player.vy = (player.hook.vy || 0) + GRAVITY * dt;
    player.whiteSurface = null;
    player.whiteDetach = 0.16;
    player.hook = null;
    return true;
  }

  if (upHeld) player.hook.hold += dt;
  if (player.hook.hold >= WHITE_HOOK_HOLD) player.hook.pulling = true;
  if (!player.hook.pulling) return false;

  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const dx = player.hook.x - cx;
  const dy = player.hook.y - cy;
  const dist = Math.hypot(dx, dy);
  const step = WHITE_HOOK_PULL * dt;

  if (dist <= step || dist <= 3) {
    player.x = player.hook.x - player.w / 2;
    player.y = player.hook.y - player.h / 2;
    player.vx = 0;
    player.vy = 0;
    attachPlayerToHookSurface(player);
    player.hookTime = 0;
    return true;
  }

  player.vx = (dx / dist) * WHITE_HOOK_PULL;
  player.vy = (dy / dist) * WHITE_HOOK_PULL;
  player.hook.vx = player.vx;
  player.hook.vy = player.vy;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  return true;
}

function shootWhiteHook(state, aimBias) {
  const { player } = state;
  const surface = normalizeWhiteSurface(player.whiteSurface) || findWhiteSurface(state);
  const nx = surface ? surface.nx : (player.whiteSurface ? player.whiteSurface.nx : 0);
  const ny = surface ? surface.ny : (player.whiteSurface ? player.whiteSurface.ny : -1);
  const tx = -ny;
  const ty = nx;
  const rawDx = aimBias ? nx + tx * aimBias : nx;
  const rawDy = aimBias ? ny + ty * aimBias : ny;
  const len = Math.hypot(rawDx, rawDy) || 1;
  const dx = rawDx / len;
  const dy = rawDy / len;
  const sx = player.x + player.w / 2;
  const sy = player.y + player.h / 2;
  let x = sx + dx * 18;
  let y = sy + dy * 18;
  let end = { x: sx + dx * WHITE_HOOK_RANGE, y: sy + dy * WHITE_HOOK_RANGE, hit: false, surface: null };
  for (let d = 0; d < WHITE_HOOK_RANGE; d += 8) {
    const point = { x, y, w: 2, h: 2 };
    const block = activeBlocks(state).find((b) => rectsOverlap(point, b));
    if (block) {
      end = { x, y, hit: true, surface: hookHitSurface(block, x, y) };
      break;
    }
    x += dx * 8;
    y += dy * 8;
  }
  const hookLength = Math.hypot(end.x - sx, end.y - sy);
  player.hook = {
    sx,
    sy,
    x: sx,
    y: sy,
    targetX: end.x,
    targetY: end.y,
    dx,
    dy,
    length: hookLength,
    progress: 0,
    extending: true,
    hit: end.hit,
    surface: end.surface,
    nx: -dx,
    ny: -dy,
    hold: 0,
    pulling: false,
    vx: 0,
    vy: 0,
  };
  player.hookTime = end.hit ? 2.0 : hookLength / WHITE_HOOK_EXTEND + 0.08;
}

function hookHitSurface(block, x, y) {
  const distances = [
    { nx: 0, ny: -1, d: Math.abs(y - block.y), block },
    { nx: 0, ny: 1, d: Math.abs(y - (block.y + block.h)), block },
    { nx: -1, ny: 0, d: Math.abs(x - block.x), block },
    { nx: 1, ny: 0, d: Math.abs(x - (block.x + block.w)), block },
  ];
  distances.sort((a, b) => a.d - b.d);
  const best = distances[0];
  return { ...best, face: faceFromNormal(best) };
}

function attachPlayerToHookSurface(player) {
  if (!player.hook) return;
  const surface = player.hook.surface || { nx: player.hook.nx, ny: player.hook.ny, block: null };
  player.x = player.hook.x - player.w / 2;
  player.y = player.hook.y - player.h / 2;
  player.vx = 0;
  player.vy = 0;
  if (surface.block) {
    player.whiteSurface = normalizeWhiteSurface(surface);
    placeWhiteOnSurface(player, player.whiteSurface);
  } else {
    player.whiteSurface = null;
  }
}

export function updateRed(state, input, dt) {
  const { player } = state;
  if (player.redDash) {
    player.redDash.t = Math.min(RED_DASH_TIME, player.redDash.t + dt);
    const p = player.redDash.t / RED_DASH_TIME;
    const eased = 1 - (1 - p) * (1 - p) * (1 - p);
    const step = RED_DASH_DISTANCE * (eased - player.redDash.lastEase);
    player.redDash.lastEase = eased;
    player.vx = player.redDash.dx * step / dt;
    player.vy = player.redDash.dy * step / dt + player.redDash.gravityVy;
    player.redDash.gravityVy += GRAVITY * RED_AIR_GRAVITY_SCALE * dt;
    if (player.redDash.t >= RED_DASH_TIME) player.redDash = null;
    return;
  }

  if (player.redQte) {
    player.redQte.t += dt;
    player.vx = 0;
    player.vy += GRAVITY * RED_AIR_GRAVITY_SCALE * dt;
    if (player.redQte.t > RED_QTE_TIME) {
      redBurnout(state);
      return;
    }
  } else {
    player.vx *= 0.82;
    player.vy += GRAVITY * dt;
  }

  const dir = input.leftShot ? [-1, 0, "left"] :
    input.rightShot ? [1, 0, "right"] :
    input.up ? [0, -1, "up"] :
    input.down ? [0, 1, "down"] : null;
  if (!dir || player.stun > 0) return;

  if (player.redQte) {
    const ready = Math.max(0.2, RED_QTE_READY - player.redQteBonus);
    player.redQteBonus = Math.max(0, player.redQteBonus - RED_KILL_QTE_BONUS * 0.25);
    if (player.redQte.t < RED_QTE_TIME * ready) {
      redBurnout(state);
      return;
    }
    player.redMisses = 0;
    startRedDash(state, dir, dt);
    return;
  }
  startRedDash(state, dir, dt);
}

function startRedDash(state, dir, dt) {
  const { player } = state;
  const firstTime = Math.min(RED_DASH_TIME, dt);
  const p = firstTime / RED_DASH_TIME;
  const firstEase = 1 - (1 - p) * (1 - p) * (1 - p);
  const firstStep = RED_DASH_DISTANCE * firstEase;
  player.vx = dir[0] * firstStep / dt;
  player.vy = dir[1] * firstStep / dt;
  player.redDash = {
    dx: dir[0],
    dy: dir[1],
    name: dir[2],
    t: firstTime,
    lastEase: firstEase,
    gravityVy: 0
  };
  player.redQte = { t: 0 };
}

function redBurnout(state) {
  const { player } = state;
  player.redQte = null;
  player.redDash = null;
  player.vx = 0;
  player.vy = 0;
  player.redMisses += 1;
  player.stun = 0.9;
  if (player.redMisses >= 5) explode(state);
}

function explode(state) {
  state.player.stun = 1.15;
  state.player.redMisses = 0;
  state.player.redQte = null;
  state.player.redDash = null;
  state.shake = 14;
}

function breakCracks(state, radius) {
  const { player, room } = state;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  for (const b of room.cracks) {
    const r = transformedRect(state, b);
    if (!b.broken && Math.hypot(cx - (r.x + r.w / 2), cy - (r.y + r.h / 2)) < radius) b.broken = true;
  }
}

export function updateGreen(state, input, dt) {
  const { player } = state;
  if (input.left) {
    player.vx = -GREEN_MOVE;
    player.facing = -1;
  } else if (input.right) {
    player.vx = GREEN_MOVE;
    player.facing = 1;
  } else {
    player.vx *= 0.82;
  }
  if (input.up) {
    const g = player.graves[player.graves.length - 1];
    if (player.greenAfterimage && g) {
      player.x = g.x;
      player.y = g.y - player.h;
      player.vx = 0;
      player.vy = 0;
      player.onGround = true;
      player.jumps = 0;
      player.coyote = 0.1;
      player.greenAfterimage = false;
    } else if (player.coyote > 0 || isGroundedNow(state)) {
      player.vy = -GREEN_JUMP;
      player.onGround = false;
      player.coyote = 0;
    }
  }
  if (input.down) {
    player.graves.push({ x: player.x, y: player.y + player.h - 32 });
    player.greenAfterimage = true;
    player.vy = 0;
  }
  if (player.greenAfterimage) {
    player.vy = 0;
  } else {
    player.vy += GREEN_GRAVITY * dt;
  }
}

export function updateBlack(state, input, dt) {
  const { player } = state;
  const didRotate = input.leftShot || input.rightShot;
  if (input.leftShot) rotateBlackWorld(state, 3);
  if (input.rightShot) rotateBlackWorld(state, 1);
  if (input.up && (player.coyote > 0 || isGroundedNow(state))) {
    player.vy = -BLACK_JUMP;
    player.onGround = false;
    player.coyote = 0;
  }
  player.vx *= 0.6;
  if (!didRotate) player.vy += BLACK_GRAVITY * dt;
  erodeBelow(state, dt * (input.downHeld ? ERODE_FAST : ERODE_RATE));
}

function rotateBlackWorld(state, delta) {
  const { player } = state;
  const center = rotatePoint(player.x + player.w / 2, player.y + player.h / 2, delta);
  player.x = center.x - player.w / 2;
  player.y = center.y - player.h / 2;
  player.vx = 0;
  player.vy = 0;
  state.worldRot = (state.worldRot + delta) % 4;
}

function erodeBelow(state, amount) {
  const { player, room } = state;
  const foot = { x: player.x - 3, y: player.y + player.h, w: player.w + 6, h: 8 };
  const candidates = [...room.erode, ...room.cracks, ...room.blocks];
  const targets = [];
  for (const b of candidates) {
    if (b.broken) continue;
    const r = transformedRect(state, b);
    if (rectsOverlap(foot, r)) {
      targets.push(b);
    }
  }
  if (!targets.length) return;
  let brokeAny = false;
  for (const target of targets) {
    if (erodeBlock(target, amount)) brokeAny = true;
  }
  if (brokeAny) state.shake = 6;
}

function erodeBlock(target, amount) {
  const maxHp = target.maxHp || 1;
  target.hp -= amount * maxHp;
  const progress = Math.max(0, Math.min(1, 1 - target.hp / maxHp));
  target.crackLevel = progress >= 2 / 3 ? 2 : progress >= 1 / 3 ? 1 : 0;
  target.sink = 0;
  if (target.hp <= 0) {
    target.sink = 32;
    target.broken = true;
    return true;
  }
  return false;
}

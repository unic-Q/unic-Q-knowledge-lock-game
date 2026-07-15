"use strict";

import {
  GRAVITY, MOVE, JUMP, RED_DASH_DISTANCE, RED_DASH_TIME, RED_QTE_TIME, RED_QTE_READY,
  RED_KILL_QTE_BONUS, RED_AIR_GRAVITY_SCALE, ROLL_SPEED, ROLL_UP, ROLL_TIME, GREEN_MOVE, GREEN_JUMP,
  GREEN_GRAVITY, BLACK_JUMP, BLACK_GRAVITY,
  WHITE_SURFACE_SPEED, WHITE_PLAGUE_SPEED, WHITE_HOOK_RANGE, WHITE_HOOK_EXTEND, WHITE_HOOK_PULL, WHITE_HOOK_HOLD,
  WHITE_SNAP, ERODE_RATE, ERODE_FAST, WALL_TOUCH_RANGE,
} from "./constants.js";
import {
  activeBlocks, findWhiteSurface, rectsOverlap, whiteSurfaceBlocks,
  transformedRect, transformedPoint, transformedPlague, isGroundedNow, rotatePoint,
} from "./physics.js";

export function updateNone(state, input, dt) {
  const { player } = state;
  const gravity = scaledGravity(state, GRAVITY);
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
  player.vy += gravity * dt;
}

export function updateWhite(state, input, dt) {
  const { player } = state;
  const gravity = scaledGravity(state, GRAVITY);
  const hadHook = Boolean(player.hook);
  if (updateWhiteHookPull(state, input.upHeld, dt)) return;
  player.whiteTurnCooldown = Math.max(0, (player.whiteTurnCooldown || 0) - dt);
  player.whiteDetach = Math.max(0, (player.whiteDetach || 0) - dt);

  const rememberedSurface = normalizeWhiteSurface(player.whiteSurface);
  if (!rememberedSurface && player.whiteDetach <= 0) resolveWhiteAirOverlap(state);
  const surface = player.whiteDetach > 0 ? null :
    isWhiteSurfaceUsable(player, rememberedSurface) ? rememberedSurface : (rememberedSurface ? null : findWhiteSurface(state));
  if (surface) {
    const dir = input.right ? 1 : input.left ? -1 : 0;
    player.whiteSurface = normalizeWhiteSurface({ ...surface, block: surface.block });
    placeWhiteOnSurface(player, player.whiteSurface);
    player.vx = 0;
    player.vy = 0;
    if (dir !== 0) {
      player.facing = dir;
      moveWhiteOnSurface(state, dir, dt);
    }
  } else {
    player.whiteSurface = null;
    player.vy += gravity * dt;
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
  if (input.up && !player.hook) shootWhiteHook(state, input.left ? -1 : input.right ? 1 : 0);
  if (!hadHook) updateWhiteHookPull(state, input.upHeld, dt);
}

function normalizeWhiteSurface(surface) {
  if (!surface || !surface.block) return null;
  const face = Number.isInteger(surface.face) ? surface.face : faceFromNormal(surface);
  const normal = normalFromFace(face);
  return { ...surface, face, nx: normal.nx, ny: normal.ny };
}

function moveWhiteOnSurface(state, dir, dt) {
  const { player } = state;
  let remaining = Math.max(0, whiteMoveSpeed(state, player, player.whiteSurface) * dt);
  let guard = 0;
  while (remaining > 0.001 && guard < 4) {
    guard += 1;
    const surface = normalizeWhiteSurface(player.whiteSurface);
    if (!surface || !surface.block) break;
    player.whiteSurface = surface;
    const previousBody = { x: player.x, y: player.y, w: player.w, h: player.h, plague: player.plague };
    const sign = whiteSurfaceCoordSign(surface, dir);
    const coord = whiteCenterCoord(player, surface);
    const limits = whiteCenterLimits(player, surface);
    const target = coord + sign * remaining;
    const edge = sign > 0 ? limits.max : limits.min;
    const reachesEdge = sign > 0 ? target > limits.max : target < limits.min;
    if (!reachesEdge) {
      setWhiteCenterCoord(player, surface, target);
      addPlagueSegment(previousBody, surface, false, sign);
      trimPlague(player);
      break;
    }

    const toEdge = Math.abs(edge - coord);
    setWhiteCenterCoord(player, surface, edge);
    addPlagueSegment(previousBody, surface, false, sign);
    trimPlague(player);
    remaining -= toEdge;
    if (player.whiteTurnCooldown > 0) break;

    const edgeIsMax = sign > 0;
    const next = findInnerCornerSurface(state, surface, dir) ||
      findSameFaceContinuation(state, surface, edge, edgeIsMax) ||
      exteriorCornerSurface(surface, edgeIsMax);
    if (!next) {
      player.whiteSurface = null;
      break;
    }
    player.whiteSurface = normalizeWhiteSurface(next);
    placeWhiteAfterSurfaceTurn(player, surface, player.whiteSurface, edge);
    addPlagueSegment({ x: player.x, y: player.y, w: player.w, h: player.h, plague: player.plague }, player.whiteSurface, true, whiteSurfaceCoordSign(player.whiteSurface, dir));
    trimPlague(player);
    if (player.whiteSurface.face !== surface.face) {
      player.whiteTurnCooldown = 0.02;
    }
  }
}

function whiteMoveSpeed(state, player, surface) {
  return isWhiteSurfacePlagued(state, { x: player.x, y: player.y, w: player.w, h: player.h }, surface)
    ? WHITE_PLAGUE_SPEED
    : WHITE_SURFACE_SPEED;
}

function whiteSurfaceCoordSign(surface, dir) {
  return surface.face === 2 || surface.face === 3 ? -dir : dir;
}

function findSameFaceContinuation(state, surface, edgeCoord, edgeIsMax) {
  const face = surface.face;
  const normal = normalFromFace(face);
  const { player } = state;
  for (const block of whiteSurfaceBlocks(state)) {
    if (block === surface.block) continue;
    const candidate = normalizeWhiteSurface({ block, face, nx: normal.nx, ny: normal.ny });
    const limits = whiteCenterLimits(player, candidate);
    if (edgeCoord < limits.min - 2 || edgeCoord > limits.max + 2) continue;
    if (Math.abs(faceEdgeValue(surface.block, face) - faceEdgeValue(block, face)) > 2) continue;
    if ((face === 0 || face === 2) && edgeIsMax && Math.abs(block.x - (edgeCoord - player.w / 2)) > 2) continue;
    if ((face === 0 || face === 2) && !edgeIsMax && Math.abs(block.x + block.w - (edgeCoord + player.w / 2)) > 2) continue;
    if ((face === 1 || face === 3) && edgeIsMax && Math.abs(block.y - (edgeCoord - player.h / 2)) > 2) continue;
    if ((face === 1 || face === 3) && !edgeIsMax && Math.abs(block.y + block.h - (edgeCoord + player.h / 2)) > 2) continue;
    return candidate;
  }
  return null;
}

function findInnerCornerSurface(state, surface, dir) {
  const tx = -surface.ny * dir;
  const ty = surface.nx * dir;
  const cx = state.player.x + state.player.w / 2;
  const cy = state.player.y + state.player.h / 2;
  const probe = { x: cx + tx * 10 - surface.nx * 8, y: cy + ty * 10 - surface.ny * 8, w: 2, h: 2 };
  const block = whiteSurfaceBlocks(state).find((b) => b !== surface.block && rectsOverlap(probe, b));
  if (!block) return null;
  const nextNormal = { nx: -tx, ny: -ty };
  if (!isWhiteFaceExposed(state, block, nextNormal)) return null;
  return normalizeWhiteSurface({ block, ...nextNormal });
}

function isWhiteFaceExposed(state, block, normal) {
  const size = 4;
  const x = normal.nx < 0 ? block.x - size : normal.nx > 0 ? block.x + block.w : block.x + block.w / 2 - size / 2;
  const y = normal.ny < 0 ? block.y - size : normal.ny > 0 ? block.y + block.h : block.y + block.h / 2 - size / 2;
  const probe = {
    x,
    y,
    w: normal.nx === 0 ? size : size,
    h: normal.ny === 0 ? size : size,
  };
  return !whiteSurfaceBlocks(state).some((other) => other !== block && rectsOverlap(probe, other));
}

function exteriorCornerSurface(surface, edgeIsMax) {
  const nextFace = adjacentFaceForEdge(surface.face, edgeIsMax);
  const normal = normalFromFace(nextFace);
  return { block: surface.block, face: nextFace, nx: normal.nx, ny: normal.ny };
}

function adjacentFaceForEdge(face, edgeIsMax) {
  if (face === 0 || face === 2) return edgeIsMax ? 1 : 3;
  return edgeIsMax ? 2 : 0;
}

function placeWhiteAfterSurfaceTurn(player, oldSurface, newSurface, oldEdge) {
  const projectedCoord = whiteCenterCoord(player, newSurface);
  const fallbackCoord = cornerCoordForTurn(player, oldSurface.face, newSurface, oldEdge);
  const coord = Number.isFinite(projectedCoord) ? projectedCoord : fallbackCoord;
  const limits = whiteCenterLimits(player, newSurface);
  setWhiteCenterCoord(player, newSurface, Math.max(limits.min, Math.min(limits.max, coord)));
}

function cornerCoordForTurn(player, oldFace, newSurface, oldEdge) {
  const limits = whiteCenterLimits(player, newSurface);
  if (newSurface.face === 1 || newSurface.face === 3) {
    if (oldFace === 0) return limits.min;
    if (oldFace === 2) return limits.max;
  }
  if (newSurface.face === 0 || newSurface.face === 2) {
    if (oldFace === 3) return limits.min;
    if (oldFace === 1) return limits.max;
  }
  return Math.max(limits.min, Math.min(limits.max, oldEdge));
}

function faceEdgeValue(block, face) {
  if (face === 0) return block.y;
  if (face === 1) return block.x + block.w;
  if (face === 2) return block.y + block.h;
  return block.x;
}

function isWhiteSurfaceUsable(player, surface) {
  if (!surface) return false;
  const b = surface.block;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const bodyHalf = player.h / 2;
  const limits = whiteCenterLimits(player, surface);
  const coord = whiteCenterCoord(player, surface);
  if (coord < limits.min - WHITE_SNAP || coord > limits.max + WHITE_SNAP) return false;
  if (surface.face === 0) return Math.abs(cy - (b.y - bodyHalf)) <= WHITE_SNAP;
  if (surface.face === 1) return Math.abs(cx - (b.x + b.w + bodyHalf)) <= WHITE_SNAP;
  if (surface.face === 2) return Math.abs(cy - (b.y + b.h + bodyHalf)) <= WHITE_SNAP;
  return Math.abs(cx - (b.x - bodyHalf)) <= WHITE_SNAP;
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
  const footHalf = player.w / 2;
  if (surface.face === 0 || surface.face === 2) {
    return { min: b.x - footHalf, max: b.x + b.w + footHalf };
  }
  return { min: b.y - footHalf, max: b.y + b.h + footHalf };
}

function whiteCenterCoord(player, surface) {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  return surface.face === 0 || surface.face === 2 ? cx : cy;
}

function setWhiteCenterCoord(player, surface, coord) {
  const b = surface.block;
  const bodyHalf = player.h / 2;
  if (surface.face === 0) {
    player.x = coord - player.w / 2;
    player.y = b.y - bodyHalf - player.h / 2;
  } else if (surface.face === 1) {
    player.x = b.x + b.w + bodyHalf - player.w / 2;
    player.y = coord - player.h / 2;
  } else if (surface.face === 2) {
    player.x = coord - player.w / 2;
    player.y = b.y + b.h + bodyHalf - player.h / 2;
  } else {
    player.x = b.x - bodyHalf - player.w / 2;
    player.y = coord - player.h / 2;
  }
  player.whiteAngle = Math.atan2(surface.ny, surface.nx) + Math.PI / 2;
}

function placeWhiteOnSurface(player, surface) {
  const limits = whiteCenterLimits(player, surface);
  setWhiteCenterCoord(player, surface, Math.max(limits.min, Math.min(limits.max, whiteCenterCoord(player, surface))));
}

function addPlagueSegment(player, surface, corner = false, pathDir = 0) {
  if (!surface) return;
  const tx = surface.nx === 0 ? 1 : 0;
  const ty = surface.nx === 0 ? 0 : 1;
  const contact = contactInterval(player, surface);
  if (!contact) return;

  const pad = corner ? 12 : 4;
  const a = contact.a - pad;
  const b = contact.b + pad;
  const n = surface.nx * contact.x + surface.ny * contact.y;
  const key = `${surface.nx},${surface.ny},${Math.round(n)}`;
  const trimSide = pathDir < 0 ? "b" : "a";
  const last = player.plague[player.plague.length - 1];
  if (last && last.key === key && last.trimSide === trimSide && !(b < Math.min(last.a, last.b) - 12 || a > Math.max(last.a, last.b) + 12)) {
    last.a = Math.min(last.a, a);
    last.b = Math.max(last.b, b);
    last.corner = last.corner || corner;
    last.thick = Math.max(last.thick || 10, corner ? 14 : 10);
    return;
  }
  player.plagueSerial = (player.plagueSerial || 0) + 1;

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
    seed: player.plagueSerial,
    order: player.plagueSerial,
    trimSide,
    playerGenerated: true,
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
      trimPlagueSegment(first, excess);
      total -= excess;
    }
  }
}

function trimPlagueSegment(segment, amount) {
  if (segment.trimSide === "b") segment.b -= Math.sign(segment.b - segment.a || 1) * amount;
  else segment.a += Math.sign(segment.b - segment.a || 1) * amount;
}

function isWhiteSurfacePlagued(state, playerBody, surface) {
  const contact = contactInterval(playerBody, surface);
  if (!contact) return false;
  const n = surface.nx * contact.x + surface.ny * contact.y;
  const a = Math.min(contact.a, contact.b);
  const b = Math.max(contact.a, contact.b);
  return [...state.player.plague, ...(state.room.plagueHazards || []).map((p) => transformedPlague(state, p))].some((p) => {
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
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const footHalf = player.w / 2;
  if (surface.nx === 0) {
    const a = Math.max(cx - footHalf, b.x);
    const end = Math.min(cx + footHalf, b.x + b.w);
    if (end - a < 5) return null;
    const y = surface.ny === -1 ? b.y - 1 : b.y + b.h + 1;
    return { a, b: end, x: (a + end) / 2, y };
  }

  const a = Math.max(cy - footHalf, b.y);
  const end = Math.min(cy + footHalf, b.y + b.h);
  if (end - a < 5) return null;
  const x = surface.nx === -1 ? b.x - 1 : b.x + b.w + 1;
  return { a, b: end, x, y: (a + end) / 2 };
}

function updateWhiteHookPull(state, upHeld, dt) {
  const { player } = state;
  const gravity = scaledGravity(state, GRAVITY);
  if (!player.hook) return false;
  if (player.hookTime <= 0) {
    player.hook = null;
    return false;
  }
  player.hookTime -= dt;
  if (player.hook.extending) {
    player.hook.progress = Math.min(player.hook.length, player.hook.progress + WHITE_HOOK_EXTEND * dt);
    updateHookOriginFromPlayer(player);
    player.hook.x = player.hook.sx + player.hook.dx * player.hook.progress;
    player.hook.y = player.hook.sy + player.hook.dy * player.hook.progress;
    if (player.hook.progress < player.hook.length) return false;
    player.hook.extending = false;
    if (player.hook.hit) {
      const currentLength = Math.hypot(player.hook.targetX - player.hook.sx, player.hook.targetY - player.hook.sy);
      if (currentLength > WHITE_HOOK_RANGE + 4) {
        player.hook.hit = false;
        player.hook.type = "surfacePull";
        player.hook.surface = null;
      } else {
        player.hook.x = player.hook.targetX;
        player.hook.y = player.hook.targetY;
      }
    }
  }
  if (!player.hook.hit) return false;

  if (!upHeld) {
    player.vx = player.hook.vx || 0;
    player.vy = (player.hook.vy || 0) + gravity * dt;
    player.whiteSurface = null;
    player.whiteDetach = 0.16;
    player.hook = null;
    return true;
  }

  if (upHeld) player.hook.hold += dt;
  if (player.hook.hold >= WHITE_HOOK_HOLD) player.hook.pulling = true;
  if (player.hook.type === "anchorSwing") {
    updateAnchorSwing(state, player, dt);
    return true;
  }
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
    const block = whiteSurfaceBlocks(state).find((b) => rectsOverlap(point, b));
    if (block) {
      end = { x, y, hit: true, surface: hookHitSurface(block, x, y) };
      break;
    }
    x += dx * 8;
    y += dy * 8;
  }
  if (!end.hit) {
    const anchor = findHookAnchor(state, sx, sy, end.x, end.y, aimBias ? 3.5 : 2);
    if (anchor) end = { x: anchor.x, y: anchor.y, hit: true, surface: null, type: "anchorSwing" };
  }
  const hookLength = Math.hypot(end.x - sx, end.y - sy);
  const hookDx = hookLength > 0.001 ? (end.x - sx) / hookLength : dx;
  const hookDy = hookLength > 0.001 ? (end.y - sy) / hookLength : dy;
  const swingSign = aimBias ? Math.sign(aimBias) : player.facing || 1;
  player.hook = {
    sx,
    sy,
    x: sx,
    y: sy,
    targetX: end.x,
    targetY: end.y,
    dx: hookDx,
    dy: hookDy,
    length: hookLength,
    progress: 0,
    extending: true,
    hit: end.hit,
    type: end.type || "surfacePull",
    surface: end.surface,
    nx: -hookDx,
    ny: -hookDy,
    hold: 0,
    pulling: false,
    swingSign,
    swingAngle: Math.atan2(sy - end.y, sx - end.x),
    swingRadius: Math.max(24, hookLength),
    vx: 0,
    vy: 0,
  };
  player.hookTime = end.type === "anchorSwing" ? 8.0 : end.hit ? 2.0 : hookLength / WHITE_HOOK_EXTEND + 0.08;
}

function updateHookOriginFromPlayer(player) {
  player.hook.sx = player.x + player.w / 2;
  player.hook.sy = player.y + player.h / 2;
}

function findHookAnchor(state, sx, sy, ex, ey, toleranceTiles) {
  const tolerance = toleranceTiles * 32;
  const segDx = ex - sx;
  const segDy = ey - sy;
  const segLen2 = segDx * segDx + segDy * segDy || 1;
  const candidates = [
    ...(state.room.anchors || []).map((anchor) => transformedPoint(state, anchor)),
    ...(state.room.fallingObjects || [])
      .filter((object) => !object.dead && object.kind === "anchor")
      .map((object) => ({ x: object.x + object.w / 2, y: object.y + object.h / 2 })),
  ];
  let best = null;
  let bestScore = Infinity;
  for (const anchor of candidates) {
    const score = pointSegmentDistance(anchor.x, anchor.y, sx, sy, ex, ey);
    if (score > tolerance) continue;
    const dot = (anchor.x - sx) * segDx + (anchor.y - sy) * segDy;
    if (dot < 0 || dot > segLen2) continue;
    if (score < bestScore) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}

function resolveWhiteAirOverlap(state) {
  const p = state.player;
  const overlap = whiteSurfaceBlocks(state)
    .filter((block) => rectsOverlap(p, block))
    .map((block) => ({
      block,
      pen: Math.min(p.x + p.w - block.x, block.x + block.w - p.x, p.y + p.h - block.y, block.y + block.h - p.y),
    }))
    .sort((a, b) => a.pen - b.pen)[0]?.block;
  if (!overlap) return;
  const leftPen = p.x + p.w - overlap.x;
  const rightPen = overlap.x + overlap.w - p.x;
  const topPen = p.y + p.h - overlap.y;
  const bottomPen = overlap.y + overlap.h - p.y;
  const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
  if (minPen === topPen && p.vy >= 0) {
    p.y -= topPen;
    p.vy = Math.min(0, p.vy);
  } else if (minPen === bottomPen && p.vy <= 0) {
    p.y += bottomPen;
    p.vy = Math.max(0, p.vy);
  } else if (minPen === leftPen) {
    p.x -= leftPen;
    p.vx = Math.min(0, p.vx);
  } else {
    p.x += rightPen;
    p.vx = Math.max(0, p.vx);
  }
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return Math.hypot(px - x, py - y);
}

function updateAnchorSwing(state, player, dt) {
  const hook = player.hook;
  const speed = WHITE_PLAGUE_SPEED;
  const currentRadius = Math.hypot(player.x + player.w / 2 - hook.x, player.y + player.h / 2 - hook.y);
  const radius = Math.max(24, Math.min(hook.swingRadius || currentRadius, currentRadius || hook.swingRadius || 24));
  hook.swingRadius = radius;
  hook.swingAngle += (hook.swingSign || 1) * (speed / radius) * dt;
  const bounds = swingBounds(state, player);
  const cx = Math.max(bounds.minX, Math.min(bounds.maxX, hook.x + Math.cos(hook.swingAngle) * radius));
  const cy = Math.max(bounds.minY, Math.min(bounds.maxY, hook.y + Math.sin(hook.swingAngle) * radius));
  hook.swingAngle = Math.atan2(cy - hook.y, cx - hook.x);
  hook.swingRadius = Math.min(hook.swingRadius, Math.max(24, Math.hypot(cx - hook.x, cy - hook.y)));
  const tangentX = -Math.sin(hook.swingAngle) * (hook.swingSign || 1);
  const tangentY = Math.cos(hook.swingAngle) * (hook.swingSign || 1);
  player.vx = tangentX * speed;
  player.vy = tangentY * speed;
  hook.vx = player.vx;
  hook.vy = player.vy;
  player.x = cx - player.w / 2;
  player.y = cy - player.h / 2;
  player.whiteSurface = null;
  player.whiteDetach = 0.16;
}

function swingBounds(state, player) {
  return {
    minX: player.w / 2,
    minY: player.h / 2,
    maxX: (state.room?.width || 32 * 20) - player.w / 2,
    maxY: (state.room?.height || 32 * 20) - player.h / 2,
  };
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
  const gravity = scaledGravity(state, GRAVITY);
  if (player.redDash) {
    player.redDash.t = Math.min(RED_DASH_TIME, player.redDash.t + dt);
    const p = player.redDash.t / RED_DASH_TIME;
    const eased = 1 - (1 - p) * (1 - p) * (1 - p);
    const step = RED_DASH_DISTANCE * (eased - player.redDash.lastEase);
    player.redDash.lastEase = eased;
    player.vx = player.redDash.dx * step / dt;
    player.vy = player.redDash.dy * step / dt + player.redDash.gravityVy;
    player.redDash.gravityVy += gravity * RED_AIR_GRAVITY_SCALE * dt;
    if (player.redDash.t >= RED_DASH_TIME) player.redDash = null;
    return;
  }

  if (player.redQte) {
    player.redQte.t += dt;
    player.vx = 0;
    player.vy += gravity * RED_AIR_GRAVITY_SCALE * dt;
    if (player.redQte.t > RED_QTE_TIME * 1.2) {
      redBurnout(state);
      return;
    }
  } else {
    player.vx *= 0.82;
    player.vy += gravity * dt;
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
  const gravity = scaledGravity(state, GREEN_GRAVITY);
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
      const target = { x: g.x, y: g.y - player.h, w: player.w, h: player.h };
      if (activeBlocks(state).some((block) => rectsOverlap(target, block))) {
        state.pendingDeathReason = "greenRecallCrush";
        return;
      }
      player.x = target.x;
      player.y = target.y;
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
    const grave = { x: player.x, y: player.y + player.h - 32, w: 28, h: 32 };
    if (canPlaceGreenGrave(player, grave)) {
      player.graves.push({ x: grave.x, y: grave.y });
      player.greenAfterimage = true;
      player.vy = 0;
    }
  }
  if (player.greenAfterimage) {
    player.vy = 0;
  } else {
    player.vy += gravity * dt;
  }
}

function canPlaceGreenGrave(player, grave) {
  return !player.graves.some((g) => rectsOverlap(grave, { x: g.x, y: g.y, w: 28, h: 32 }));
}

export function updateBlack(state, input, dt) {
  const { player } = state;
  const gravity = scaledGravity(state, BLACK_GRAVITY);
  const didRotate = input.leftShot || input.rightShot;
  if (input.leftShot) rotateBlackWorld(state, 3);
  if (input.rightShot) rotateBlackWorld(state, 1);
  if (input.up && (player.coyote > 0 || isGroundedNow(state))) {
    player.vy = -BLACK_JUMP;
    player.onGround = false;
    player.coyote = 0;
  }
  player.vx *= 0.6;
  if (!didRotate) player.vy += gravity * dt;
  erodeBelow(state, dt * (input.downHeld ? ERODE_FAST : ERODE_RATE));
}

function scaledGravity(state, baseGravity) {
  return baseGravity * (state.gravityScale || 1);
}

function rotateBlackWorld(state, delta) {
  const { player } = state;
  const center = rotatePoint(player.x + player.w / 2, player.y + player.h / 2, delta);
  player.x = center.x - player.w / 2;
  player.y = center.y - player.h / 2;
  for (const grave of player.graves) {
    const p = rotatePoint(grave.x + 14, grave.y + 16, delta);
    grave.x = p.x - 14;
    grave.y = p.y - 16;
  }
  player.plague = player.plague.map((plague) => transformedPlague({ worldRot: delta }, plague));
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

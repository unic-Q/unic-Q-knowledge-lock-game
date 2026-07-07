"use strict";

import {
  WIDTH, HEIGHT, COLS, ROWS, TILE, ROOM_FLOOR, EXIT_TOP_X, EXIT_BOTTOM_X, FORMS, GRAVITY,
} from "./constants.js";
import { makePlayer } from "./player.js";
import { parseRoom, worldRooms } from "./world.js";
import { rectsOverlap, moveAxis, pointNearSegment, transformedRect } from "./physics.js";
import { updateNone, updateWhite, updateRed, updateGreen, updateBlack } from "./mechanics.js";
import { draw } from "./render.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const roomTitle = document.getElementById("roomTitle");
const formLabel = document.getElementById("formLabel");
const hintLabel = document.getElementById("hintLabel");
const debugPanel = document.getElementById("debugPanel");

const keys = new Set();
let prevKeys = new Set();
let lastTime = 0;
let debugSendTimer = 0;
let audioCtx = null;

const state = {
  worldRooms,
  roomIndex: 0,
  room: null,
  player: null,
  form: "none",
  selectedForm: "red",
  helmetHeld: 0,
  helmetOwned: false,
  unlockedForms: new Set(),
  choosing: false,
  mapOpen: false,
  visitedRooms: new Set(),
  greenAfterimageMemory: false,
  worldRot: 0,
  shake: 0,
  raisedFlags: new Set(),
  checkpoint: { roomIndex: 0, x: 70, y: ROOM_FLOOR * TILE - 28, form: "none", helmetOwned: false, worldRot: 0 },
  lastRespawn: "none",
  eventLog: [],
};

function logEvent(type, data = {}) {
  state.eventLog.push({
    type,
    room: state.room?.id,
    x: Number(state.player?.x?.toFixed?.(2) ?? 0),
    y: Number(state.player?.y?.toFixed?.(2) ?? 0),
    ...data,
  });
  state.eventLog = state.eventLog.slice(-8);
}

function oneShot(code) {
  return keys.has(code) && !prevKeys.has(code);
}

function inputState() {
  return {
    left: keys.has("ArrowLeft") || keys.has("KeyA"),
    right: keys.has("ArrowRight") || keys.has("KeyD"),
    up: oneShot("ArrowUp") || oneShot("KeyW"),
    upHeld: keys.has("ArrowUp") || keys.has("KeyW"),
    down: oneShot("ArrowDown") || oneShot("KeyS"),
    downHeld: keys.has("ArrowDown") || keys.has("KeyS"),
    space: oneShot("Space"),
    spaceHeld: keys.has("Space"),
    leftShot: oneShot("ArrowLeft") || oneShot("KeyA"),
    rightShot: oneShot("ArrowRight") || oneShot("KeyD"),
  };
}

function loadRoom(index, spawn) {
  state.roomIndex = Math.max(0, Math.min(index, state.worldRooms.length - 1));
  state.room = parseRoom(state.worldRooms[state.roomIndex]);
  state.visitedRooms.add(state.room.id);
  const start = spawn || state.room.spawn;
  state.player = makePlayer(start[0], start[1]);
  if (!spawn && state.roomIndex === 0) {
    state.checkpoint = { roomIndex: state.roomIndex, x: start[0], y: start[1], form: "none", helmetOwned: state.helmetOwned, worldRot: 0 };
  }
  state.selectedForm = state.form === "none" ? "red" : state.form;
  state.worldRot = state.checkpoint.worldRot ?? 0;
  state.helmetHeld = 0;
  state.choosing = false;
  updateHud();
}

function respawn(reason = "unknown") {
  logEvent("respawn", { reason });
  state.lastRespawn = reason;
  state.roomIndex = state.checkpoint.roomIndex;
  state.room = parseRoom(state.worldRooms[state.roomIndex]);
  state.helmetOwned = state.checkpoint.helmetOwned;
  state.form = state.checkpoint.form;
  state.player = makePlayer(state.checkpoint.x, state.checkpoint.y);
  state.worldRot = 0;
  state.helmetHeld = 0;
  state.choosing = false;
  updateHud();
}

function updateHud() {
  roomTitle.textContent = state.room.name;
  formLabel.textContent = FORMS[state.form].name;
  formLabel.style.color = FORMS[state.form].color;
  hintLabel.textContent = state.helmetOwned ? "长按 Space 选骑士" : "第2关可拾取头盔，也可以不拿";
}

function switchForm(next) {
  if (!state.helmetOwned) return;
  if (!state.unlockedForms.has(next)) return;
  if (state.form === "none" && next === "none") return;
  if (state.form !== "none" && next === "none") return;
  const wasWhite = state.form === "white";
  const wasGreen = state.form === "green";
  if (wasGreen) state.greenAfterimageMemory = state.player.greenAfterimage;
  state.form = next;
  if (next === "green") state.player.greenAfterimage = state.greenAfterimageMemory;
  state.player.redQte = null;
  state.player.redDash = null;
  state.player.hook = null;
  if (wasWhite && next !== "white") state.player.plagueGrace = 0.45;
  updateHud();
}

function beginChoice() {
  if (!state.helmetOwned) return;
  state.choosing = true;
  state.selectedForm = state.form === "none" ? "red" : state.form;
  hintLabel.textContent = "时间暂停：上白 左黑 右红 下绿";
}

function finishChoice() {
  state.choosing = false;
  switchForm(state.selectedForm);
  hintLabel.textContent = state.helmetOwned ? "长按 Space 选骑士" : "头盔是可选物品";
}

function handleChoice() {
  if ((keys.has("ArrowUp") || keys.has("KeyW")) && state.unlockedForms.has("white")) state.selectedForm = "white";
  if ((keys.has("ArrowRight") || keys.has("KeyD")) && state.unlockedForms.has("red")) state.selectedForm = "red";
  if ((keys.has("ArrowLeft") || keys.has("KeyA")) && state.unlockedForms.has("black")) state.selectedForm = "black";
  if ((keys.has("ArrowDown") || keys.has("KeyS")) && state.unlockedForms.has("green")) state.selectedForm = "green";
}

function activateCheckpoint() {
  const { room, player } = state;
  if (!room.flag) return;
  const flagRect = transformedRect(state, room.flag);
  if (!rectsOverlap(player, flagRect)) return;
  if (!state.raisedFlags.has(room.id)) room.flagProgress = 0;
  state.raisedFlags.add(room.id);
  state.checkpoint = {
    roomIndex: state.roomIndex,
    x: flagRect.x + 24,
    y: flagRect.y + flagRect.h - player.h,
    form: state.form,
    helmetOwned: state.helmetOwned,
    worldRot: state.worldRot,
  };
}

function changeRoom(dir) {
  const targetId = state.room.links[dir];
  if (!targetId) return false;
  const { player } = state;
  const fromId = state.room.id;
  let spawn = [player.x, player.y];
  if (dir === "r") spawn = safeSideSpawn(targetId, "l", 6, player.y);
  if (dir === "l") spawn = safeSideSpawn(targetId, "r", WIDTH - player.w - 6, player.y);
  if (dir === "u") spawn = [(EXIT_BOTTOM_X + 1) * TILE + 4, ROOM_FLOOR * TILE - player.h - 2];
  if (dir === "d") spawn = [(EXIT_TOP_X + 1) * TILE + 4, 6];
  loadRoom(targetId - 1, spawn);
  logEvent("changeRoom", { dir, from: fromId, to: targetId, spawnX: Number(spawn[0].toFixed(2)), spawnY: Number(spawn[1].toFixed(2)) });
  return true;
}

function safeSideSpawn(targetId, side, x, fallbackY) {
  const roomDef = state.worldRooms[targetId - 1];
  const col = side === "l" ? 0 : COLS - 1;
  const rows = [];
  for (let row = 1; row < ROWS - 1; row += 1) {
    if (roomDef.blocks[row]?.[col] === ".") rows.push(row);
  }
  const desiredRow = Math.max(1, Math.min(ROWS - 2, Math.floor((fallbackY + state.player.h / 2) / TILE)));
  const row = rows.length ? rows.reduce((best, current) =>
    Math.abs(current - desiredRow) < Math.abs(best - desiredRow) ? current : best
  ) : desiredRow;
  return [x, row * TILE + TILE - state.player.h];
}

function inSideExit(side) {
  const col = side === "l" ? 0 : COLS - 1;
  const top = Math.max(0, Math.floor(state.player.y / TILE));
  const bottom = Math.min(ROWS - 1, Math.floor((state.player.y + state.player.h - 1) / TILE));
  for (let row = top; row <= bottom; row += 1) {
    if (state.room.blocks[row]?.[col] === ".") return true;
  }
  return false;
}

function inTopExit() {
  const cx = state.player.x + state.player.w / 2;
  return cx >= EXIT_TOP_X * TILE && cx <= (EXIT_TOP_X + 3) * TILE;
}

function inBottomExit() {
  const cx = state.player.x + state.player.w / 2;
  return cx >= EXIT_BOTTOM_X * TILE && cx <= (EXIT_BOTTOM_X + 3) * TILE;
}

function update(dt) {
  const input = inputState();

  if (oneShot("KeyR")) respawn("manual");
  if (oneShot("KeyM")) state.mapOpen = !state.mapOpen;
  if (oneShot("KeyN")) changeRoom("r") || loadRoom(state.roomIndex + 1, [70, ROOM_FLOOR * TILE - 28]);
  if (oneShot("KeyP")) changeRoom("l") || loadRoom(state.roomIndex - 1, [WIDTH - 70, ROOM_FLOOR * TILE - 28]);

  if (keys.has("Space")) {
    state.helmetHeld += dt;
    if (state.helmetHeld > 0.22 && !state.choosing) beginChoice();
  } else {
    if (state.choosing) finishChoice();
    state.helmetHeld = 0;
  }
  if (state.choosing) {
    handleChoice();
    prevKeys = new Set(keys);
    return;
  }

  if (state.raisedFlags.has(state.room.id)) state.room.flagProgress = Math.min(1, (state.room.flagProgress ?? 1) + dt * 4.5);

  const { player } = state;
  if (player.rollRefreshQueued) {
    player.rollRefreshQueued = false;
    playRollRefresh();
  }
  player.dropTimer = Math.max(0, player.dropTimer - dt);
  player.coyote = Math.max(0, player.coyote - dt);
  player.stun = Math.max(0, player.stun - dt);
  player.plagueGrace = Math.max(0, player.plagueGrace - dt);
  player.onGround = false;

  if (player.stun > 0) {
    player.vx *= 0.85;
    player.vy += GRAVITY * dt;
  } else if (state.form === "none") updateNone(state, input, dt);
  else if (state.form === "white") updateWhite(state, input, dt);
  else if (state.form === "red") updateRed(state, input, dt);
  else if (state.form === "green") updateGreen(state, input, dt);
  else if (state.form === "black") updateBlack(state, input, dt);

  handleSwitches();
  moveAxis(state, "x", dt);
  moveAxis(state, "y", dt);

  handlePickups();
  handleSwitches();
  handleEnemies();
  activateCheckpoint();
  handleHazards();
  handleRoomEdges();

  const fellOut = state.form === "black"
    ? player.y > ROWS * TILE + 360
    : player.y > ROWS * TILE + 100;
  if (fellOut) respawn("fall");
  state.shake = Math.max(0, state.shake - 25 * dt);
  updateDebugPanel();
  sendDebugSnapshot(dt);
  prevKeys = new Set(keys);
}

function debugSnapshot() {
  const p = state.player;
  if (!p) return null;
  const s = p.whiteSurface;
  const lastPlague = p.plague[p.plague.length - 1];
  return {
    room: state.room?.id,
    form: state.form,
    worldRot: state.worldRot,
    player: {
      x: Number(p.x.toFixed(2)),
      y: Number(p.y.toFixed(2)),
      vx: Number(p.vx.toFixed(2)),
      vy: Number(p.vy.toFixed(2)),
      w: p.w,
      h: p.h,
      onGround: p.onGround,
    },
    whiteSurface: s ? {
      nx: s.nx,
      ny: s.ny,
      block: s.block ? {
        x: Number(s.block.x.toFixed(2)),
        y: Number(s.block.y.toFixed(2)),
        w: s.block.w,
        h: s.block.h,
      } : null,
    } : null,
    hook: p.hook ? {
      x: Number(p.hook.x?.toFixed?.(2) ?? p.hook.x),
      y: Number(p.hook.y?.toFixed?.(2) ?? p.hook.y),
      hit: p.hook.hit,
      pulling: p.hook.pulling,
      hold: Number(p.hook.hold?.toFixed?.(2) ?? p.hook.hold),
      time: Number(p.hookTime?.toFixed?.(2) ?? p.hookTime),
    } : null,
    input: {
      left: keys.has("ArrowLeft") || keys.has("KeyA"),
      right: keys.has("ArrowRight") || keys.has("KeyD"),
      up: keys.has("ArrowUp") || keys.has("KeyW"),
      down: keys.has("ArrowDown") || keys.has("KeyS"),
      space: keys.has("Space"),
    },
    lastRespawn: state.lastRespawn,
    eventLog: state.eventLog,
    plagueCount: p.plague.length,
    lastPlague: lastPlague ? {
      key: lastPlague.key,
      nx: lastPlague.nx,
      ny: lastPlague.ny,
      tx: lastPlague.tx,
      ty: lastPlague.ty,
      a: Number(lastPlague.a?.toFixed?.(2) ?? lastPlague.a),
      b: Number(lastPlague.b?.toFixed?.(2) ?? lastPlague.b),
      n: Number(lastPlague.n?.toFixed?.(2) ?? lastPlague.n),
    } : null,
  };
}

window.__gameDebug = {
  state,
  snapshot: debugSnapshot,
};

function updateDebugPanel() {
  if (!debugPanel) return;
  const snap = debugSnapshot();
  if (!snap) return;
  const p = snap.player;
  const s = snap.whiteSurface;
  debugPanel.textContent = [
    `room ${snap.room} ${snap.form} rot ${snap.worldRot}`,
    `p (${p.x}, ${p.y}) v (${p.vx}, ${p.vy})`,
    `surf ${s ? `${s.nx},${s.ny} b(${s.block?.x},${s.block?.y})` : "none"}`,
    `input L${+snap.input.left} R${+snap.input.right} U${+snap.input.up} D${+snap.input.down}`,
    `hook ${snap.hook ? `${snap.hook.hit ? "hit" : "miss"} pull${+snap.hook.pulling}` : "none"}`,
    `plague ${snap.plagueCount}`,
  ].join("\n");
}

function sendDebugSnapshot(dt) {
  debugSendTimer -= dt;
  if (debugSendTimer > 0) return;
  debugSendTimer = 0.2;
  const snap = debugSnapshot();
  if (!snap) return;
  fetch("http://127.0.0.1:8011/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snap),
  }).catch(() => {});
}

function handlePickups() {
  const { room, player } = state;
  if (room.helmet && !state.worldRooms[state.roomIndex].helmet.taken && rectsOverlap(player, room.helmet)) {
    state.worldRooms[state.roomIndex].helmet.taken = true;
    state.helmetOwned = true;
    state.unlockedForms.add("red");
    state.form = "red";
    state.selectedForm = "red";
    state.checkpoint.helmetOwned = true;
    hintLabel.textContent = "长按 Space 选骑士";
    state.shake = 5;
  }
  for (const item of room.abilityPickups || []) {
    if (!state.helmetOwned || item.taken || !rectsOverlap(player, item)) continue;
    state.unlockedForms.add(item.form);
    item.taken = true;
    state.selectedForm = item.form;
    switchForm(item.form);
    state.shake = 5;
  }
}

function handleHazards() {
  const { player, room } = state;
  for (const h of room.hazards || []) {
    const canIgnore = h.type === "electric" && state.form === "green" && player.greenAfterimage;
    if (!canIgnore && rectsOverlap(expandedRollRect(player), h) && !surviveHazard(player)) return;
  }
  if (state.form !== "white") {
    for (const p of room.plagueHazards) {
      if (Math.hypot(player.x + 12 - p.x, player.y + 14 - p.y) < 17 && !surviveHazard(player)) return;
    }
    if (player.plagueGrace <= 0) {
      for (const p of player.plague) {
        if (touchesPlague(player.x + 12, player.y + 14, p, 15) && !surviveHazard(player)) return;
      }
    }
  }
  if (state.form !== "green") {
    for (let i = 1; i < player.graves.length; i += 1) {
      if (pointNearSegment(player.x + 12, player.y + 14, player.graves[i - 1], player.graves[i]) < 8 && !surviveHazard(player)) return;
    }
  }
}

function surviveHazard(player) {
  if (player.rollTimer > 0) {
    refreshRoll(player);
    return true;
  }
  respawn("hazard");
  return false;
}

function touchesPlague(px, py, plague, radius) {
  if (!Number.isFinite(plague.a) || !Number.isFinite(plague.b)) {
    return Math.hypot(px - plague.x, py - plague.y) < radius;
  }
  const t = px * plague.tx + py * plague.ty;
  const n = px * plague.nx + py * plague.ny;
  const clamped = Math.max(plague.a, Math.min(plague.b, t));
  return Math.hypot(t - clamped, n - plague.n) < radius;
}

function handleSwitches() {
  const { room, player } = state;
  const bodyCanPress = !(state.form === "green" && player.greenAfterimage);
  for (const s of room.switches || []) {
    const body = bodyCanPress && rectsOverlap(player, s);
    const grave = player.graves.some((g) => rectsOverlap({ x: g.x, y: g.y, w: 28, h: 32 }, s));
    s.pressed = body || grave;
  }
  const open = (room.switches || []).some((s) => s.pressed);
  for (const g of room.gates || []) g.open = open;
}

function handleEnemies() {
  const { room, player } = state;
  for (const enemy of room.enemies || []) {
    if (!enemy.alive) continue;
    if (canWhiteKill(enemy) || canGreenLineKill(enemy)) {
      enemy.alive = false;
      continue;
    }
    if (!rectsOverlap(player, enemy)) continue;
    const blackStomp = state.form === "black" && player.vy > 120 && player.y + player.h <= enemy.y + 12;
    if (state.form === "red" && player.redDash) {
      enemy.alive = false;
      player.redQteBonus = Math.min(0.28, player.redQteBonus + 0.16);
    } else if (blackStomp) {
      enemy.alive = false;
      player.vy = Math.min(player.vy, -360);
    } else if (player.rollTimer <= 0) {
      respawn("enemy");
      return;
    }
  }
}

function canWhiteKill(enemy) {
  return state.player.plague.some((p) => touchesPlague(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, p, 18));
}

function canGreenLineKill(enemy) {
  const { player } = state;
  for (let i = 1; i < player.graves.length; i += 1) {
    if (pointNearSegment(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, player.graves[i - 1], player.graves[i]) < 12) return true;
  }
  return false;
}

function expandedRollRect(player) {
  if (player.rollTimer <= 0) return player;
  const padX = player.w * 0.1;
  const padY = player.h * 0.1;
  return { x: player.x - padX, y: player.y - padY, w: player.w + padX * 2, h: player.h + padY * 2 };
}

function refreshRoll(player) {
  player.rollCooldown = 0;
  player.rollRefreshQueued = true;
}

function playRollRefresh() {
  try {
    audioCtx ||= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 720;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch {
    // Best effort; browsers may block audio before user input.
  }
}

function handleRoomEdges() {
  const { player } = state;
  if (player.x <= 0 && inSideExit("l")) {
    if (!changeRoom("l")) player.x = 0;
  } else if (player.x + player.w >= WIDTH && inSideExit("r")) {
    if (!changeRoom("r")) player.x = WIDTH - player.w;
  }
  if (player.y <= 0 && inTopExit()) {
    if (!changeRoom("u")) player.y = 0;
  } else if (player.y + player.h >= ROWS * TILE && inBottomExit()) {
    if (!changeRoom("d")) player.y = ROWS * TILE - player.h;
  }
}

function frame(time) {
  const dt = Math.min(0.033, (time - lastTime) / 1000 || 0.016);
  lastTime = time;
  update(dt);
  draw(ctx, state);
  requestAnimationFrame(frame);
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

loadRoom(0);
requestAnimationFrame(frame);

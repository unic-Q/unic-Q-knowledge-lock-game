"use strict";

import {
  WIDTH, HEIGHT, ROWS, TILE, ROOM_FLOOR, EXIT_TOP_X, EXIT_BOTTOM_X, FORMS, GRAVITY,
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
  worldRot: 0,
  shake: 0,
  raisedFlags: new Set(),
  exploredRooms: new Set(),
  checkpoint: {
    roomIndex: 0,
    x: 70,
    y: ROOM_FLOOR * TILE - 28,
    form: "none",
    helmetOwned: false,
    unlockedForms: [],
    worldRot: 0,
  },
};

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
    leftShot: oneShot("ArrowLeft") || oneShot("KeyA"),
    rightShot: oneShot("ArrowRight") || oneShot("KeyD"),
    spaceShot: oneShot("Space"),
  };
}

function loadRoom(index, spawn) {
  state.roomIndex = Math.max(0, Math.min(index, state.worldRooms.length - 1));
  state.room = parseRoom(state.worldRooms[state.roomIndex]);
  state.exploredRooms.add(state.room.id);
  const start = spawn || state.room.spawn;
  state.player = makePlayer(start[0], start[1]);
  if (!spawn && state.roomIndex === 0) {
    state.checkpoint = {
      roomIndex: state.roomIndex,
      x: start[0],
      y: start[1],
      form: "none",
      helmetOwned: state.helmetOwned,
      unlockedForms: [...state.unlockedForms],
      worldRot: 0,
    };
  }
  state.selectedForm = state.form === "none" ? firstUnlockedForm() : state.form;
  state.worldRot = state.checkpoint.worldRot ?? 0;
  state.helmetHeld = 0;
  state.choosing = false;
  state.mapOpen = false;
  updateHud();
}

function respawn() {
  state.roomIndex = state.checkpoint.roomIndex;
  state.room = parseRoom(state.worldRooms[state.roomIndex]);
  state.exploredRooms.add(state.room.id);
  state.helmetOwned = state.checkpoint.helmetOwned;
  state.unlockedForms = new Set(state.checkpoint.unlockedForms || (state.helmetOwned ? ["red"] : []));
  state.form = state.checkpoint.form;
  state.player = makePlayer(state.checkpoint.x, state.checkpoint.y);
  state.worldRot = 0;
  state.helmetHeld = 0;
  state.choosing = false;
  state.mapOpen = false;
  updateHud();
}

function firstUnlockedForm() {
  return state.unlockedForms.values().next().value || "red";
}

function defaultHint() {
  if (!state.helmetOwned) return "Space 冲刺；靠近头盔按 Space 拾取，也可以不拿";
  return state.unlockedForms.size > 1 ? "长按 Space 选骑士" : `${FORMS[state.form].name} 已获得`;
}

function updateHud() {
  roomTitle.textContent = state.room.name;
  formLabel.textContent = FORMS[state.form].name;
  formLabel.style.color = FORMS[state.form].color;
  hintLabel.textContent = defaultHint();
}

function switchForm(next) {
  if (!state.unlockedForms.has(next)) return;
  if (state.form === "none" && next === "none") return;
  if (state.form !== "none" && next === "none") return;
  const wasWhite = state.form === "white";
  state.form = next;
  state.player.redQte = null;
  state.player.redDash = null;
  state.player.hook = null;
  if (wasWhite && next !== "white") state.player.plagueGrace = 0.45;
  updateHud();
}

function beginChoice() {
  if (state.unlockedForms.size < 2) return;
  state.choosing = true;
  state.selectedForm = state.unlockedForms.has(state.form) ? state.form : firstUnlockedForm();
  hintLabel.textContent = "时间暂停：上白 左黑 右红 下绿";
}

function finishChoice() {
  state.choosing = false;
  switchForm(state.selectedForm);
  hintLabel.textContent = defaultHint();
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
    unlockedForms: [...state.unlockedForms],
    worldRot: state.worldRot,
  };
}

function changeRoom(dir) {
  const targetId = state.room.links[dir];
  if (!targetId) return false;
  const { player } = state;
  let spawn = [player.x, player.y];
  if (dir === "r") spawn = [6, player.y];
  if (dir === "l") spawn = [WIDTH - player.w - 6, player.y];
  if (dir === "u") spawn = [(EXIT_BOTTOM_X + 1) * TILE + 4, ROOM_FLOOR * TILE - player.h - 2];
  if (dir === "d") spawn = [(EXIT_TOP_X + 1) * TILE + 4, 6];
  loadRoom(targetId - 1, spawn);
  return true;
}

function inSideExit() {
  const cy = state.player.y + state.player.h / 2;
  return cy >= (ROOM_FLOOR - 2) * TILE && cy <= ROOM_FLOOR * TILE;
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

  if (oneShot("KeyM")) {
    state.mapOpen = !state.mapOpen;
    state.helmetHeld = 0;
    state.choosing = false;
  }
  if (oneShot("Escape") && state.mapOpen) state.mapOpen = false;
  if (state.mapOpen) {
    prevKeys = new Set(keys);
    return;
  }

  if (oneShot("KeyR")) respawn();
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

  if (handlePickups(input)) input.spaceShot = false;

  if (state.raisedFlags.has(state.room.id)) state.room.flagProgress = Math.min(1, (state.room.flagProgress ?? 1) + dt * 4.5);

  const { player } = state;
  player.dropTimer = Math.max(0, player.dropTimer - dt);
  player.coyote = Math.max(0, player.coyote - dt);
  player.stun = Math.max(0, player.stun - dt);
  player.plagueGrace = Math.max(0, player.plagueGrace - dt);
  player.noneDashCooldown = Math.max(0, player.noneDashCooldown - dt);
  player.onGround = false;

  if (player.stun > 0) {
    player.vx *= 0.85;
    player.vy += GRAVITY * dt;
  } else if (state.form === "none") updateNone(state, input, dt);
  else if (state.form === "white") updateWhite(state, input, dt);
  else if (state.form === "red") updateRed(state, input, dt);
  else if (state.form === "green") updateGreen(state, input, dt);
  else if (state.form === "black") updateBlack(state, input, dt);

  moveAxis(state, "x", dt);
  moveAxis(state, "y", dt);

  activateCheckpoint();
  handleHazards();
  handleRoomEdges();
  updateContextHint();

  const fellOut = state.form === "black"
    ? player.y > ROWS * TILE + 360
    : player.y > ROWS * TILE + 100;
  if (fellOut) respawn();
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
    plagueCount: p.plague.length,
    lastPlague: lastPlague ? {
      key: lastPlague.key,
      cell: !!lastPlague.cell,
      cellX: lastPlague.cellX,
      cellY: lastPlague.cellY,
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

function pickupTarget() {
  const { room, player } = state;
  const source = state.worldRooms[state.roomIndex].helmet;
  if (!room.helmet || !source || source.taken) return null;
  return rectsOverlap(player, room.helmet) ? source : null;
}

function handlePickups(input) {
  const item = pickupTarget();
  if (!item) return false;
  if (!input.spaceShot) return false;
  const form = item.form || "red";
  item.taken = true;
  state.helmetOwned = true;
  state.unlockedForms.add(form);
  state.checkpoint.helmetOwned = true;
  state.checkpoint.unlockedForms = [...state.unlockedForms];
  switchForm(form);
  state.checkpoint.form = state.form;
  hintLabel.textContent = `${FORMS[form].name} 已获得`;
  state.shake = 5;
  return true;
}

function updateContextHint() {
  if (state.choosing) return;
  const item = pickupTarget();
  if (item) {
    hintLabel.textContent = `按 Space 拾取${FORMS[item.form || "red"].name}`;
    return;
  }
  hintLabel.textContent = defaultHint();
}

function handleHazards() {
  const { player, room } = state;
  if (state.form !== "white") {
    for (const p of room.plagueHazards) {
      if (Math.hypot(player.x + 12 - p.x, player.y + 14 - p.y) < 17) respawn();
    }
    if (player.plagueGrace <= 0) {
      for (const p of player.plague) {
        if (p.cell ? rectsOverlap(player, p) : touchesPlague(player.x + 12, player.y + 14, p, 15)) respawn();
      }
    }
  }
  if (state.form !== "green") {
    for (let i = 1; i < player.graves.length; i += 1) {
      if (pointNearSegment(player.x + 12, player.y + 14, player.graves[i - 1], player.graves[i]) < 8) respawn();
    }
  }
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

function handleRoomEdges() {
  const { player } = state;
  if (player.x <= 0 && inSideExit()) {
    if (!changeRoom("l")) player.x = 0;
  } else if (player.x + player.w >= WIDTH && inSideExit()) {
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
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyM"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

loadRoom(0);
requestAnimationFrame(frame);

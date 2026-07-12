"use strict";

import {
  WIDTH, HEIGHT, COLS, ROWS, TILE, ROOM_FLOOR, EXIT_TOP_X, EXIT_BOTTOM_X, FORMS, GRAVITY,
  ROLL_REFRESH_SOUND_INTERVAL, SIDE_HAZARD_GRACE,
} from "./constants.js";
import { makePlayer } from "./player.js";
import { parseRoom, worldRooms } from "./world.js";
import { rectsOverlap, moveAxis, pointNearSegment, transformedRect, rotatePoint, activeBlocks } from "./physics.js";
import { updateNone, updateWhite, updateRed, updateGreen, updateBlack } from "./mechanics.js";
import { draw } from "./render.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const roomTitle = document.getElementById("roomTitle");
const formLabel = document.getElementById("formLabel");
const hintLabel = document.getElementById("hintLabel");
const coinLabel = document.getElementById("coinLabel");
const debugPanel = document.getElementById("debugPanel");

const keys = new Set();
let prevKeys = new Set();
let lastTime = 0;
let debugSendTimer = 0;
let audioCtx = null;
let mapDrag = null;
const urlParams = new URLSearchParams(window.location.search);

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
  mapPan: { x: 0, y: 0 },
  visitedRooms: new Set(),
  mapPositions: null,
  greenAfterimageMemory: false,
  worldRot: 0,
  shake: 0,
  raisedFlags: new Set(),
  collectedCoins: new Set(),
  defeatedBossRooms: new Set(),
  clearedBossRooms: new Set(),
  checkpoint: { roomIndex: 0, x: 70, y: ROOM_FLOOR * TILE - 28, form: "none", helmetOwned: false, unlockedForms: [], worldRot: 0 },
  lastRespawn: "none",
  eventLog: [],
  overallPlaytest: false,
  roomIndexById: new Map(worldRooms.map((room, index) => [room.id, index])),
  deathTimer: 0,
  deathReason: null,
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
  applyBossRoomProgress();
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  state.visitedRooms.add(state.room.id);
  const start = spawn || state.room.spawn;
  state.player = makePlayer(start[0], start[1]);
  if (!spawn && state.roomIndex === 0) {
    state.checkpoint = { roomIndex: state.roomIndex, x: start[0], y: start[1], form: "none", helmetOwned: state.helmetOwned, unlockedForms: [...state.unlockedForms], worldRot: 0 };
  }
  state.selectedForm = state.form === "none" ? "red" : state.form;
  state.worldRot = state.checkpoint.worldRot ?? 0;
  state.greenAfterimageMemory = false;
  state.helmetHeld = 0;
  state.choosing = false;
  updateHud();
}

function roomIndexForId(id) {
  const numericId = Number(id);
  return state.roomIndexById.get(numericId) ?? Math.max(0, Math.min(numericId - 1, state.worldRooms.length - 1));
}

function normalizePlaytestBlocks(blocks, requestedSize = 20) {
  const source = Array.isArray(blocks) ? blocks : [];
  const size = Number(requestedSize) === 40 || source.length > 20 ||
    source.some((row) => String(Array.isArray(row) ? row.join("") : row || "").length > 20) ? 40 : 20;
  return Array.from({ length: size }, (_, y) => {
    const row = Array.isArray(source[y]) ? source[y].join("") : String(source[y] || "");
    return row.padEnd(size, ".").slice(0, size);
  });
}

function normalizePlaytestSpawn(spawn) {
  if (Array.isArray(spawn)) {
    return [
      Number.isFinite(Number(spawn[0])) ? Number(spawn[0]) : 70,
      Number.isFinite(Number(spawn[1])) ? Number(spawn[1]) : ROOM_FLOOR * TILE - 28,
    ];
  }
  if (spawn && typeof spawn === "object") {
    return [
      Number.isFinite(Number(spawn.x)) ? Number(spawn.x) : 70,
      Number.isFinite(Number(spawn.y)) ? Number(spawn.y) : ROOM_FLOOR * TILE - 28,
    ];
  }
  return [70, ROOM_FLOOR * TILE - 28];
}

function playtestCellHasBody(blocks, x, y) {
  const cell = blocks[y]?.[x];
  return Boolean(cell && cell !== ".");
}

function playtestPlagueSurfaceHasBody(blocks, surface) {
  if (surface.face === 0) return playtestCellHasBody(blocks, surface.x, surface.y) || playtestCellHasBody(blocks, surface.x, surface.y - 1);
  if (surface.face === 1) return playtestCellHasBody(blocks, surface.x, surface.y) || playtestCellHasBody(blocks, surface.x + 1, surface.y);
  return playtestCellHasBody(blocks, surface.x, surface.y);
}

function normalizePlaytestSurfacePlagues(surfacePlagues, blocks) {
  const seen = new Set();
  return Array.isArray(surfacePlagues) ? surfacePlagues.map(normalizeSurfacePlague).filter((item) => {
    if (!item) return false;
    const key = `${item.x},${item.y},${item.face}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) : [];
}

function normalizeSurfacePlague(item) {
  if (!Number.isInteger(item?.x) || !Number.isInteger(item?.y) || !Number.isInteger(item?.face)) return null;
  let { x, y } = item;
  let face = ((item.face % 4) + 4) % 4;
  if (face === 2) {
    y += 1;
    face = 0;
  } else if (face === 3) {
    x -= 1;
    face = 1;
  }
  return { x, y, face };
}

function normalizeTargetDefaults(defaults) {
  if (!defaults || typeof defaults !== "object") return {};
  const normalized = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (!key.startsWith("plague:")) {
      normalized[key] = value;
      continue;
    }
    const [x, y, face] = key.slice("plague:".length).split(",").map(Number);
    const surface = normalizeSurfacePlague({ x, y, face });
    if (surface) normalized[`plague:${surface.x},${surface.y},${surface.face}`] = value;
  }
  return normalized;
}

function normalizePlaytestRoom(room, fallbackId = 1) {
  const id = Number.isFinite(Number(room?.id ?? room?.room)) ? Number(room.id ?? room.room) : fallbackId;
  const roomSize = Number(room?.roomSize) === 40 ? 40 : 20;
  const blocks = normalizePlaytestBlocks(room?.blocks, roomSize);
  return {
    id,
    roomSize,
    name: room?.name || `试玩房间 ${String(id).padStart(2, "0")}`,
    spawn: room?.spawn === null ? null : normalizePlaytestSpawn(room?.spawn),
    worldStart: Boolean(room?.worldStart),
    flag: null,
    helmet: null,
    links: room?.links && typeof room.links === "object" ? room.links : {},
    blocks,
    surfacePlagues: normalizePlaytestSurfacePlagues(room?.surfacePlagues, blocks),
    controlBindings: Array.isArray(room?.controlBindings) ? room.controlBindings : [],
    lightningChains: Array.isArray(room?.lightningChains) ? room.lightningChains : [],
    lightningNodes: Array.isArray(room?.lightningNodes) ? room.lightningNodes : [],
    emitters: Array.isArray(room?.emitters) ? room.emitters : [],
    sequencers: Array.isArray(room?.sequencers) ? room.sequencers : [],
    targetDefaults: normalizeTargetDefaults(room?.targetDefaults),
    enemyPatrols: Array.isArray(room?.enemyPatrols) ? room.enemyPatrols : [],
    advancedEnemies: Array.isArray(room?.advancedEnemies) ? room.advancedEnemies : [],
    movingPlatforms: Array.isArray(room?.movingPlatforms) ? room.movingPlatforms : [],
    platformGenerators: Array.isArray(room?.platformGenerators) ? room.platformGenerators : [],
    dropBosses: Array.isArray(room?.dropBosses) ? room.dropBosses : [],
  };
}

function linksFromMapPositions(rooms, positions) {
  const links = Object.fromEntries(rooms.map((room) => [String(room.id), {}]));
  const entries = rooms
    .map((room) => ({
      id: room.id,
      scale: Number(room.roomSize) === 40 ? 2 : 1,
      ...(positions?.[String(room.id)] || {}),
    }))
    .filter((room) => Number.isFinite(room.x) && Number.isFinite(room.y));
  if (!entries.length) return links;

  const tolerance = 8;
  for (const room of entries) {
    for (const other of entries) {
      if (room.id === other.id) continue;
      const roomW = 116 * room.scale;
      const roomH = 104 * room.scale;
      const otherW = 116 * other.scale;
      const otherH = 104 * other.scale;
      const yOverlap = Math.min(room.y + roomH, other.y + otherH) - Math.max(room.y, other.y) >= 16;
      const xOverlap = Math.min(room.x + roomW, other.x + otherW) - Math.max(room.x, other.x) >= 16;
      const link = { id: other.id, offsetX: room.x - other.x, offsetY: room.y - other.y };
      if (yOverlap && Math.abs(other.x - (room.x + roomW)) <= tolerance) links[String(room.id)].r = link;
      if (yOverlap && Math.abs(other.x + otherW - room.x) <= tolerance) links[String(room.id)].l = link;
      if (xOverlap && Math.abs(other.y - (room.y + roomH)) <= tolerance) links[String(room.id)].d = link;
      if (xOverlap && Math.abs(other.y + otherH - room.y) <= tolerance) links[String(room.id)].u = link;
    }
  }
  return links;
}

async function loadExportedWorld() {
  const response = await fetch("/api/exported-levels", { cache: "no-store" });
  if (!response.ok) return false;
  const payload = await response.json();
  if (!payload?.ok || !Array.isArray(payload.rooms) || !payload.rooms.length) return false;

  const rooms = payload.rooms.map((room, index) => normalizePlaytestRoom({
    ...room,
    id: room.id ?? room.room ?? index + 1,
    name: room.name || `${String(room.id ?? room.room ?? index + 1).padStart(2, "0")} / 导出关卡`,
  }, index + 1));
  const generatedLinks = linksFromMapPositions(rooms, payload.map?.positions);
  for (const room of rooms) {
    room.links = Object.keys(room.links || {}).length ? room.links : generatedLinks[String(room.id)] || {};
  }
  rooms.sort((a, b) => a.id - b.id);
  state.worldRooms = rooms;
  state.roomIndexById = new Map(rooms.map((room, index) => [room.id, index]));
  state.mapPositions = payload.map?.positions || null;
  state.overallPlaytest = true;
  loadRoom(0);
  return true;
}

function respawn(reason = "unknown") {
  if (state.deathTimer > 0) return;
  state.deathTimer = 1;
  state.deathReason = reason;
  state.lastRespawn = reason;
  logEvent("death", { reason });
}

function finishRespawn(reason = "unknown") {
  logEvent("respawn", { reason });
  state.lastRespawn = reason;
  state.deathTimer = 0;
  state.deathReason = null;
  state.roomIndex = state.checkpoint.roomIndex;
  state.room = parseRoom(state.worldRooms[state.roomIndex]);
  applyBossRoomProgress(true);
  state.helmetOwned = state.checkpoint.helmetOwned;
  state.unlockedForms = new Set(state.checkpoint.unlockedForms || []);
  state.form = state.checkpoint.form;
  if (state.form !== "none" && !state.unlockedForms.has(state.form)) state.form = state.unlockedForms.values().next().value || "none";
  state.selectedForm = state.form === "none" ? "red" : state.form;
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
  coinLabel.textContent = `金币 × ${state.collectedCoins.size}`;
}

function applyLoadout(loadout) {
  const unlocks = {
    none: [],
    red: ["red"],
    "red-green": ["red", "green"],
    "red-green-white": ["red", "green", "white"],
    all: ["red", "green", "white", "black"],
  }[loadout] || [];
  state.helmetOwned = unlocks.length > 0;
  state.unlockedForms = new Set(unlocks);
  state.form = unlocks[0] || "none";
  state.selectedForm = unlocks[0] || "red";
  return unlocks;
}

function setupEditorPlaytest() {
  if (!urlParams.has("editorTest")) return false;
  const raw = localStorage.getItem("editorPlaytestRoom");
  if (!raw) return false;
  let room;
  try {
    room = JSON.parse(raw);
  } catch {
    return false;
  }
  const unlocks = applyLoadout(room.playtestLoadout || "none");
  state.worldRooms = [normalizePlaytestRoom({ ...room, id: 1, name: room.name || "编辑器试玩", links: {} }, 1)];
  state.roomIndexById = new Map(state.worldRooms.map((item, index) => [item.id, index]));
  state.roomIndex = 0;
  state.checkpoint = {
    roomIndex: 0,
    x: state.worldRooms[0].spawn[0],
    y: state.worldRooms[0].spawn[1],
    form: state.form,
    helmetOwned: state.helmetOwned,
    unlockedForms: [...state.unlockedForms],
    worldRot: 0,
  };
  loadRoom(0);
  state.checkpoint = {
    roomIndex: 0,
    x: state.worldRooms[0].spawn[0],
    y: state.worldRooms[0].spawn[1],
    form: state.form,
    helmetOwned: state.helmetOwned,
    unlockedForms: [...state.unlockedForms],
    worldRot: 0,
  };
  hintLabel.textContent = "编辑器试玩：R 重置，长按 Space 选已解锁骑士";
  return true;
}

function setupEditorWorldPlaytest() {
  if (!urlParams.has("worldTest")) return false;
  const raw = localStorage.getItem("editorWorldPlaytest");
  if (!raw) return false;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(data.rooms) || !data.rooms.length) return false;
  const unlocks = applyLoadout(data.loadout || "none");
  state.overallPlaytest = true;
  state.worldRooms = data.rooms.map((room, index) => normalizePlaytestRoom({
    ...room,
    name: room.name || `总体试玩 ${String(room.id ?? index + 1).padStart(2, "0")}`,
  }, index + 1));
  state.roomIndexById = new Map(state.worldRooms.map((item, index) => [item.id, index]));
  state.mapPositions = data.map?.positions || null;
  const startIndex = roomIndexForId(Number(data.startRoom) || state.worldRooms[0].id);
  const startRoom = state.worldRooms[startIndex] || state.worldRooms[0];
  const startSpawn = normalizePlaytestSpawn(startRoom.spawn);
  state.checkpoint = {
    roomIndex: startIndex,
    x: startSpawn[0],
    y: startSpawn[1],
    form: state.form,
    helmetOwned: state.helmetOwned,
    unlockedForms: [...state.unlockedForms],
    worldRot: 0,
  };
  loadRoom(startIndex, startSpawn);
  state.checkpoint = {
    roomIndex: startIndex,
    x: startSpawn[0],
    y: startSpawn[1],
    form: state.form,
    helmetOwned: state.helmetOwned,
    unlockedForms: [...state.unlockedForms],
    worldRot: 0,
  };
  hintLabel.textContent = unlocks.length ? "总体试玩：相邻关卡无缝切换，长按 Space 选骑士" : "总体试玩：相邻关卡无缝切换";
  return true;
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
    key: `flag:${room.id}`,
    form: state.form,
    helmetOwned: state.helmetOwned,
    unlockedForms: [...state.unlockedForms],
    worldRot: state.worldRot,
  };
}

function changeRoom(dir) {
  const link = normalizeRoomLink(state.room.links[dir]);
  const targetId = link?.id;
  if (!targetId) return false;
  const { player } = state;
  const fromId = state.room.id;
  if (state.overallPlaytest) {
    return seamlessChangeRoom(dir, link, fromId);
  }
  let spawn = [player.x, player.y];
  if (dir === "r") spawn = safeSideSpawn(targetId, "l", 6, mappedSideY(targetId));
  if (dir === "l") spawn = safeSideSpawn(targetId, "r", targetRoomSize(targetId).width - player.w - 6, mappedSideY(targetId));
  if (dir === "u") spawn = [(EXIT_BOTTOM_X + 1) * TILE + 4, ROOM_FLOOR * TILE - player.h - 2];
  if (dir === "d") spawn = [(EXIT_TOP_X + 1) * TILE + 4, 6];
  loadRoom(roomIndexForId(targetId), spawn);
  clearGreenRoomState();
  logEvent("changeRoom", { dir, from: fromId, to: targetId, spawnX: Number(spawn[0].toFixed(2)), spawnY: Number(spawn[1].toFixed(2)) });
  return true;
}

function seamlessChangeRoom(dir, link, fromId) {
  const old = state.player;
  const targetId = link.id;
  const targetIndex = roomIndexForId(targetId);
  const current = currentRoomSize();
  const target = targetRoomSize(targetId);
  const offsetX = Number(link.offsetX || 0) * (20 * TILE) / 116;
  const offsetY = Number(link.offsetY || 0) * (20 * TILE) / 104;
  let spawn = [old.x, old.y];
  if (dir === "r") spawn = [old.x - current.width, old.y + offsetY];
  if (dir === "l") spawn = [old.x + target.width, old.y + offsetY];
  if (dir === "u") spawn = [old.x + offsetX, old.y + target.height];
  if (dir === "d") spawn = [old.x + offsetX, old.y - current.height];
  spawn[0] = Math.max(0, Math.min(target.width - old.w, spawn[0]));
  spawn[1] = Math.max(0, Math.min(target.height - old.h, spawn[1]));

  const preserved = {
    vx: old.vx,
    vy: old.vy,
    facing: old.facing,
    jumps: old.jumps,
    coyote: old.coyote,
    dropTimer: old.dropTimer,
    rollTimer: old.rollTimer,
    rollCooldown: old.rollCooldown,
    rollRefreshSoundCooldown: old.rollRefreshSoundCooldown,
    sideHazardGrace: old.sideHazardGrace,
    sideHazardSide: old.sideHazardSide,
    sideHazardLatched: old.sideHazardLatched,
    redQte: old.redQte,
    redDash: old.redDash,
    redQteBonus: old.redQteBonus,
    redMisses: old.redMisses,
    stun: old.stun,
    graves: [],
    greenAfterimage: false,
    plague: old.plague,
    plagueGrace: old.plagueGrace,
  };
  loadRoom(targetIndex, spawn);
  Object.assign(state.player, preserved);
  state.player.x = spawn[0];
  state.player.y = spawn[1];
  state.player.whiteSurface = null;
  state.player.hook = null;
  state.player.hookTime = 0;
  clearGreenRoomState();
  logEvent("changeRoom", { dir, from: fromId, to: targetId, seamless: true, spawnX: Number(spawn[0].toFixed(2)), spawnY: Number(spawn[1].toFixed(2)) });
  return true;
}

function clearGreenRoomState() {
  state.player.graves = [];
  state.player.greenAfterimage = false;
  state.greenAfterimageMemory = false;
}

function normalizeRoomLink(link) {
  if (link && typeof link === "object") {
    const id = Number(link.id ?? link.room ?? link.target);
    if (!Number.isFinite(id)) return null;
    return {
      id,
      offsetX: Number(link.offsetX || 0),
      offsetY: Number(link.offsetY || 0),
    };
  }
  const id = Number(link);
  return Number.isFinite(id) ? { id, offsetX: 0, offsetY: 0 } : null;
}

function currentRoomSize() {
  return {
    cols: state.room?.cols || COLS,
    rows: state.room?.rows || ROWS,
    width: state.room?.width || WIDTH,
    height: state.room?.height || HEIGHT,
  };
}

function targetRoomSize(targetId) {
  const roomDef = state.worldRooms[roomIndexForId(targetId)] || {};
  const roomSize = Number(roomDef.roomSize) === 40 ? 40 : 20;
  const rows = Array.isArray(roomDef.blocks) ? Math.max(roomSize, roomDef.blocks.length) : roomSize;
  const cols = Array.isArray(roomDef.blocks)
    ? Math.max(roomSize, ...roomDef.blocks.map((row) => String(row || "").length))
    : roomSize;
  return { cols, rows, width: cols * TILE, height: rows * TILE };
}

function mappedSideY(targetId) {
  return Math.max(0, Math.min(targetRoomSize(targetId).height, state.player.y));
}

function safeSideSpawn(targetId, side, x, fallbackY) {
  const roomDef = state.worldRooms[roomIndexForId(targetId)];
  const size = targetRoomSize(targetId);
  const col = side === "l" ? 0 : size.cols - 1;
  const rows = [];
  for (let row = 1; row < size.rows - 1; row += 1) {
    if (roomDef.blocks[row]?.[col] === ".") rows.push(row);
  }
  const desiredRow = Math.max(1, Math.min(size.rows - 2, Math.floor((fallbackY + state.player.h / 2) / TILE)));
  const row = rows.length ? rows.reduce((best, current) =>
    Math.abs(current - desiredRow) < Math.abs(best - desiredRow) ? current : best
  ) : desiredRow;
  return [x, row * TILE + TILE - state.player.h];
}

function inSideExit(side) {
  const size = currentRoomSize();
  const col = side === "l" ? 0 : size.cols - 1;
  const grid = state.worldRooms[state.roomIndex].blocks;
  const top = Math.max(0, Math.floor(state.player.y / TILE));
  const bottom = Math.min(size.rows - 1, Math.floor((state.player.y + state.player.h - 1) / TILE));
  for (let row = top; row <= bottom; row += 1) {
    if (grid[row]?.[col] === ".") return true;
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
  if (state.deathTimer > 0) {
    state.deathTimer = Math.max(0, state.deathTimer - dt);
    if (state.deathTimer <= 0) finishRespawn(state.deathReason || "unknown");
    state.shake = Math.max(0, state.shake - 25 * dt);
    updateDebugPanel();
    sendDebugSnapshot(dt);
    prevKeys = new Set(keys);
    return;
  }
  if (oneShot("KeyM")) {
    state.mapOpen = !state.mapOpen;
    mapDrag = null;
    canvas.style.cursor = state.mapOpen ? "grab" : "default";
  }
  if (oneShot("Escape") && state.mapOpen) {
    state.mapOpen = false;
    mapDrag = null;
    canvas.style.cursor = "default";
  }
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
  player.rollRefreshSoundCooldown = Math.max(0, player.rollRefreshSoundCooldown - dt);
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

  updateBoss(dt);
  handleSwitches(dt);
  updatePlatformGenerators(dt);
  updateDropBosses(dt);
  updateFallingObjects(dt);
  updateMovingPlatforms(dt);
  moveAxis(state, "x", dt);
  moveAxis(state, "y", dt);

  handleSwitches(0);
  updateEmitters(dt);
  handlePickups();
  updateBreakablePlatforms(dt);
  handleCheckpoints();
  player.sideHazardContactThisFrame = false;
  updateEnemyPatrols(dt);
  handleEnemies();
  activateCheckpoint();
  handleHazards();
  handleBossHazards();
  handleRoomEdges();

  const roomSize = currentRoomSize();
  const fellOut = state.form === "black"
    ? player.y > roomSize.height + 360
    : player.y > roomSize.height + 100;
  if (fellOut && !state.overallPlaytest) {
    player.x = Math.max(0, Math.min(roomSize.width - player.w, player.x));
    player.y = Math.min(player.y, roomSize.height - player.h);
    player.vy = 0;
  }
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
  const roomDef = state.worldRooms[state.roomIndex];
  return {
    room: state.room?.id,
    blocks: Array.isArray(roomDef?.blocks) ? roomDef.blocks : [],
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
  for (const coin of room.coins || []) {
    if (coin.disabled) continue;
    const key = `${room.id}:${coin.x},${coin.y}`;
    if (state.collectedCoins.has(key) || !rectsOverlap(player, coin)) continue;
    state.collectedCoins.add(key);
    coin.taken = true;
    state.shake = Math.max(state.shake, 2);
    updateHud();
  }
  for (const object of room.fallingObjects || []) {
    if (object.dead || object.kind !== "coin" || !rectsOverlap(player, object)) continue;
    state.collectedCoins.add(`${room.id}:fall:${object.id}`);
    object.dead = true;
    state.shake = Math.max(state.shake, 2);
    updateHud();
  }
  if (room.helmet && !state.worldRooms[state.roomIndex].helmet.taken && rectsOverlap(player, room.helmet)) {
    state.worldRooms[state.roomIndex].helmet.taken = true;
    state.helmetOwned = true;
    state.unlockedForms.add("red");
    state.form = "red";
    state.selectedForm = "red";
    state.checkpoint.helmetOwned = true;
    state.checkpoint.unlockedForms = [...state.unlockedForms];
    state.checkpoint.form = state.form;
    hintLabel.textContent = "长按 Space 选骑士";
    state.shake = 5;
  }
  for (const item of room.abilityPickups || []) {
    if (state.unlockedForms.has(item.form)) {
      item.taken = true;
      continue;
    }
    if (item.taken || !rectsOverlap(player, item)) continue;
    if (!state.helmetOwned) {
      state.helmetOwned = true;
      state.checkpoint.helmetOwned = true;
    }
    state.unlockedForms.add(item.form);
    item.taken = true;
    state.selectedForm = item.form;
    switchForm(item.form);
    state.checkpoint.helmetOwned = state.helmetOwned;
    state.checkpoint.unlockedForms = [...state.unlockedForms];
    state.checkpoint.form = state.form;
    state.shake = 5;
  }
}

function handleHazards() {
  const { player, room } = state;
  for (const projectile of room.projectiles || []) {
    if (!rectsOverlap(expandedRollRect(player), projectile)) continue;
    if (projectileIgnoredByForm(projectile)) continue;
    if (!surviveHazard(player)) return;
  }
  for (const h of room.hazards || []) {
    if (h.disabled) continue;
    const canIgnore = h.type === "electric" && state.form === "green" && player.greenAfterimage;
    if (!canIgnore && rectsOverlap(expandedRollRect(player), h)) {
      if (!surviveHazard(player)) return;
    }
  }
  if (state.form !== "white") {
    for (const p of room.plagueHazards) {
      if (p.disabled) continue;
      if (!rectTouchesPlague(player, p, 15)) continue;
      if (protectSideHazard(player, plagueHazardSide(player, p, 15))) continue;
      if (!surviveHazard(player)) return;
    }
    if (player.plagueGrace <= 0) {
      for (const p of player.plague) {
        if (!rectTouchesPlague(player, p, 15)) continue;
        if (protectSideHazard(player, plagueHazardSide(player, p, 15))) continue;
        if (!surviveHazard(player)) return;
      }
    }
  }
  if (state.form !== "green") {
    for (let i = 1; i < player.graves.length; i += 1) {
      const a = player.graves[i - 1];
      const b = player.graves[i];
      if (pointNearSegment(player.x + 12, player.y + 14, a, b) >= 8) continue;
      if (protectSideHazard(player, segmentHazardSide(player, a, b, 8))) continue;
      if (!surviveHazard(player)) return;
    }
  }
  for (const segment of room.lightningSegments || []) {
    if (segment.disabled || state.form === "green") continue;
    const a = rotatePoint(segment.ax, segment.ay, state.worldRot);
    const b = rotatePoint(segment.bx, segment.by, state.worldRot);
    const hazard = insetSegment(a, b, 10);
    if (!hazard) continue;
    if (!rectTouchesSegment(player, hazard.a, hazard.b, 2)) continue;
    if (protectSideHazard(player, segmentHazardSide(player, hazard.a, hazard.b, 10))) continue;
    if (!surviveHazard(player)) return;
  }
  for (const object of room.fallingObjects || []) {
    if (object.dead) continue;
    if (object.kind === "spike" && rectsOverlap(expandedRollRect(player), object)) {
      if (!surviveHazard(player)) return;
    }
    if (object.kind === "plague" && state.form !== "white" && rectsOverlap(player, object)) {
      if (!surviveHazard(player)) return;
    }
    if (object.kind === "lightning" && state.form !== "green") {
      const hazard = fallingLightningHazard(object);
      if (!rectTouchesSegment(player, hazard.a, hazard.b, 3)) continue;
      if (protectSideHazard(player, segmentHazardSide(player, hazard.a, hazard.b, 10))) continue;
      if (!surviveHazard(player)) return;
    }
  }
  if (!player.sideHazardContactThisFrame) {
    player.sideHazardGrace = 0;
    player.sideHazardSide = 0;
    player.sideHazardLatched = false;
  }
}

function projectileIgnoredByForm(projectile) {
  if (projectile.hazard === "plague") return state.form === "white";
  if (projectile.hazard === "lightning") return state.form === "green";
  return false;
}

function applyBossRoomProgress(respawning = false) {
  const { room } = state;
  if (!room?.bosses?.length) return;
  const defeated = state.defeatedBossRooms.has(room.id);
  const cleared = state.clearedBossRooms.has(room.id);
  if (defeated) {
    room.bosses.length = 0;
    room.bossBattleStarted = true;
  } else if (respawning) {
    const boss = room.bosses[0];
    boss.state = "intro";
    boss.timer = 1.5;
    room.bossBattleStarted = true;
  }
  room.bossDefeated = defeated;
  room.bossCleared = cleared;
  room.finalSwitchArmed = false;
  for (const gate of room.gates || []) {
    if (cleared) gate.openAmount = 1;
  }
}

function bossBody(boss) {
  return { x: boss.x + 6, y: boss.y + 6, w: boss.w - 12, h: boss.h - 12 };
}

function bossObstacles() {
  return [
    ...(state.room.blocks || []).filter((b) => !b.broken),
    ...(state.room.cracks || []).filter((b) => !b.broken),
    ...(state.room.erode || []).filter((b) => !b.broken),
    ...(state.room.gates || []).filter((g) => !g.open || g.openAmount < 0.95),
  ];
}

function bossCanMove(boss, dx, dy) {
  const test = bossBody({ ...boss, x: boss.x + dx, y: boss.y + dy });
  return !bossObstacles().some((block) => rectsOverlap(test, block));
}

function chooseBossDirection(boss) {
  const player = state.player;
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;
  const bx = boss.x + boss.w / 2;
  const by = boss.y + boss.h / 2;
  let dx = px - bx;
  let dy = py - by;
  let length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const clearDistance = (ux, uy) => {
    let distance = 0;
    while (distance < TILE * 18 && bossCanMove(boss, ux * (distance + TILE / 4), uy * (distance + TILE / 4))) distance += TILE / 4;
    return distance;
  };
  if (clearDistance(dx, dy) < TILE * 2) {
    const directions = [];
    for (let sy = -1; sy <= 1; sy += 1) {
      for (let sx = -1; sx <= 1; sx += 1) {
        if (!sx && !sy) continue;
        const n = Math.hypot(sx, sy);
        const ux = sx / n;
        const uy = sy / n;
        directions.push({ ux, uy, distance: clearDistance(ux, uy), alignment: ux * dx + uy * dy });
      }
    }
    directions.sort((a, b) => b.distance - a.distance || b.alignment - a.alignment);
    dx = directions[0].ux;
    dy = directions[0].uy;
  }
  boss.aimX = dx;
  boss.aimY = dy;
}

function startBossAim(boss) {
  chooseBossDirection(boss);
  boss.state = "aim";
  boss.timer = bossPatternValue(boss, [0.75, 0.9, 1.05]);
  boss.shotFired = false;
}

function bossPatternValue(boss, values) {
  return values[Math.min(values.length - 1, Math.max(0, (boss.hp || 1) - 1))];
}

function fireBossProjectile(boss) {
  const player = state.player;
  const dx = player.x + player.w / 2 - (boss.x + boss.w / 2);
  const dy = player.y + player.h / 2 - (boss.y + boss.h / 2);
  const length = Math.hypot(dx, dy) || 1;
  const speed = bossPatternValue(boss, [6, 5.5, 5]) * TILE;
  const size = TILE * 0.55;
  state.room.projectiles.push({
    x: boss.x + boss.w / 2 - size / 2,
    y: boss.y + boss.h / 2 - size / 2,
    w: size,
    h: size,
    vx: dx / length * speed,
    vy: dy / length * speed,
    speed,
    hazard: "spike",
    trackingTime: bossPatternValue(boss, [1.1, 0.9, 0.7]),
    life: 8,
    source: "boss",
  });
}

function defeatBoss(boss) {
  const room = state.room;
  state.defeatedBossRooms.add(room.id);
  room.bossDefeated = true;
  room.bosses = [];
  for (const emitter of room.emitters || []) emitter.disabled = true;
  room.projectiles = [];
  room.finalSwitchArmed = false;
  state.shake = 12;
}

function updateBoss(dt) {
  const { room, player } = state;
  const boss = room.bosses?.[0];
  if (!boss) return;
  boss.hitFlash = Math.max(0, boss.hitFlash - dt);
  const triggerActive = (room.hiddenTriggers || []).some((t) => t.once && t.pressed);
  if (boss.state === "waiting" && triggerActive) {
    room.bossBattleStarted = true;
    player.graves = [];
    player.plague = [];
    player.hook = null;
    player.greenAfterimage = false;
    boss.state = "intro";
    boss.timer = 1.5;
  }
  if (boss.state === "waiting") return;
  boss.timer -= dt;
  if (boss.state === "intro" && boss.timer <= 0) startBossAim(boss);
  else if (boss.state === "aim" && boss.timer <= 0) {
    const speed = bossPatternValue(boss, [10, 9, 8]) * TILE;
    boss.vx = boss.aimX * speed;
    boss.vy = boss.aimY * speed;
    boss.chargeDistance = 0;
    boss.state = "charge";
  } else if (boss.state === "charge") {
    let distance = Math.hypot(boss.vx, boss.vy) * dt;
    while (distance > 0) {
      const step = Math.min(TILE / 4, distance);
      const speed = Math.hypot(boss.vx, boss.vy) || 1;
      const mx = boss.vx / speed * step;
      const my = boss.vy / speed * step;
      if (!bossCanMove(boss, mx, my)) {
        boss.state = "recover";
        boss.timer = 0.85;
        break;
      }
      boss.x += mx;
      boss.y += my;
      boss.chargeDistance += step;
      distance -= step;
      if (boss.chargeDistance >= TILE * 18) {
        boss.state = "recover";
        boss.timer = 0.85;
        break;
      }
    }
  } else if (boss.state === "recover") {
    if (!boss.shotFired && boss.timer <= 0.55 && (room.projectiles || []).filter((p) => p.source === "boss").length < 3) {
      fireBossProjectile(boss);
      boss.shotFired = true;
    }
    if (boss.timer <= 0) startBossAim(boss);
  }
}

function handleBossHazards() {
  const boss = state.room.bosses?.[0];
  if (boss && boss.state !== "waiting" && boss.state !== "intro" && rectsOverlap(state.player, bossBody(boss))) surviveHazard(state.player);
  for (const dropBoss of state.room.dropBosses || []) {
    if (dropBoss.enabled === false || dropBoss.defeated) continue;
    if (rectsOverlap(state.player, dropBoss)) hitDropBoss(dropBoss);
  }
}

function hitDropBoss(boss) {
  if (boss.hitCooldown > 0) return;
  boss.hp = Math.max(0, (boss.hp || boss.maxHp || 8) - 1);
  boss.hitCooldown = 0.8;
  boss.pauseTimer = Math.max(boss.pauseTimer || 0, 2);
  boss.warnings = [];
  state.shake = Math.max(state.shake, 7);
  logEvent("dropBossHit", { hp: boss.hp });
  if (boss.hp <= 0) {
    boss.defeated = true;
    boss.enabled = false;
    boss.warnings = [];
    boss.phase = null;
  } else if (boss.hp <= (boss.nextPhaseHp ?? 0)) {
    boss.nextPhaseHp = Math.max(0, (boss.nextPhaseHp ?? 0) - 2);
    startDropBossPhase(boss);
  }
}

function updateEmitters(dt) {
  const { room, player } = state;
  room.projectiles ||= [];
  for (const projectile of room.projectiles) {
    if (projectile.trackingTime > 0) {
      const dx = player.x + player.w / 2 - (projectile.x + projectile.w / 2);
      const dy = player.y + player.h / 2 - (projectile.y + projectile.h / 2);
      const length = Math.hypot(dx, dy) || 1;
      projectile.vx = dx / length * projectile.speed;
      projectile.vy = dy / length * projectile.speed;
      projectile.trackingTime -= dt;
    }
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (activeBlocks(state).some((block) => rectsOverlap(projectile, block))) projectile.life = 0;
    const boss = room.bosses?.[0];
    if (boss && projectile.source === "emitter" && !boss.spentEmitters.has(projectile.sourceEmitterIndex) && rectsOverlap(projectile, bossBody(boss))) {
      boss.spentEmitters.add(projectile.sourceEmitterIndex);
      boss.hp -= 1;
      boss.hitFlash = 0.25;
      boss.state = "recover";
      boss.timer = 1.4;
      boss.shotFired = false;
      projectile.life = 0;
      room.projectiles.forEach((p) => {
        if (p.sourceEmitterIndex === projectile.sourceEmitterIndex) p.life = 0;
      });
      if (boss.hp <= 0) defeatBoss(boss);
    }
  }
  room.projectiles = room.projectiles.filter((p) => p.life > 0);
  for (const emitter of room.emitters || []) {
    updatePathMover(emitter, dt);
    if (emitter.disabled) continue;
    const bossEmitter = Boolean(room.bosses?.length || room.bossDefeated);
    if (bossEmitter && (room.bosses?.[0]?.spentEmitters.has(emitter.index) || room.projectiles.some((p) => p.sourceEmitterIndex === emitter.index))) continue;
    emitter.timer = (emitter.timer || 0) + dt;
    const period = Math.max(0.2, emitter.period || 2);
    const activeWindow = period * Math.max(0.05, Math.min(1, emitter.duty || 0.35));
    const phase = emitter.timer % period;
    emitter.cooldown = Math.max(0, (emitter.cooldown || 0) - dt);
    if (phase > activeWindow || emitter.cooldown > 0) continue;
    emitter.cooldown = Math.max(0.08, period / 6);
    const size = Math.max(4, (emitter.size || 0.5) * TILE);
    const speed = Math.max(0.5, emitter.speed || 6) * TILE;
    const direction = emitterDirection(emitter);
    const dx = direction.x;
    const dy = direction.y;
    room.projectiles.push({
      x: emitter.x + TILE / 2 - size / 2,
      y: emitter.y + TILE / 2 - size / 2,
      w: size,
      h: size,
      vx: dx * speed,
      vy: dy * speed,
      speed,
      hazard: emitter.hazard || "spike",
      trackingTime: Math.max(0, Math.min(3, Number(emitter.trackingTime || 0))),
      life: 8,
      source: "emitter",
      sourceEmitterIndex: emitter.index,
    });
  }
}

function emitterDirection(emitter) {
  const mode = emitter.directionMode || emitter.direction || "vector";
  if (mode === "up") return { x: 0, y: -1 };
  if (mode === "down") return { x: 0, y: 1 };
  if (mode === "left") return { x: -1, y: 0 };
  if (mode === "right") return { x: 1, y: 0 };
  if (mode === "facing") {
    const path = Array.isArray(emitter.path) ? emitter.path : [];
    const target = path[emitter.pathIndex % path.length];
    const cx = emitter.x + emitter.w / 2;
    const cy = emitter.y + emitter.h / 2;
    if (target) {
      const dx = target.x - cx;
      const dy = target.y - cy;
      const length = Math.hypot(dx, dy);
      if (length > 0.001) return { x: dx / length, y: dy / length };
    }
  }
  return { x: Number(emitter.dx || 1), y: Number(emitter.dy || 0) };
}

function updatePathMover(entity, dt) {
  if (!Array.isArray(entity.path) || entity.path.length < 2 || !entity.moveSpeed) return;
  if (entity.pathFinished) return;
  entity.pathIndex ??= 1;
  const target = entity.path[entity.pathIndex % entity.path.length];
  const cx = entity.x + entity.w / 2;
  const cy = entity.y + entity.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const distance = Math.hypot(dx, dy);
  const step = entity.moveSpeed * dt;
  if (distance <= Math.max(0.001, step)) {
    entity.x = target.x - entity.w / 2;
    entity.y = target.y - entity.h / 2;
    if (entity.loop === false && entity.pathIndex >= entity.path.length - 1) {
      entity.pathFinished = true;
      return;
    }
    entity.pathIndex = (entity.pathIndex + 1) % entity.path.length;
    return;
  }
  entity.x += dx / distance * step;
  entity.y += dy / distance * step;
}

function updateMovingPlatforms(dt) {
  const { room, player } = state;
  for (const platform of room.movingPlatforms || []) {
    if (!platform.enabled) continue;
    const previous = { x: platform.x, y: platform.y, w: platform.w, h: platform.h };
    const rider = player.y + player.h <= previous.y + 4 &&
      player.y + player.h >= previous.y - 6 &&
      player.x + player.w > previous.x + 3 &&
      player.x < previous.x + previous.w - 3 &&
      player.vy >= -20;
    updatePathMover(platform, dt);
    const dx = platform.x - previous.x;
    const dy = platform.y - previous.y;
    platform.lastDx = dx;
    platform.lastDy = dy;
    if (rider) {
      player.x += dx;
      player.y += dy;
    }
  }
}

function updatePlatformGenerators(dt) {
  const { room } = state;
  if (dropBossPhaseActive(room)) return;
  for (const generator of room.platformGenerators || []) {
    if (!generator.enabled) continue;
    generator.timer = (generator.timer || 0) - dt;
    if (generator.timer > 0) continue;
    generator.timer += generator.interval;
    const cells = Math.max(1, Math.floor(generator.w / TILE));
    const platformLength = Math.max(1, Math.floor(generator.platformLength || 1));
    const cell = Math.floor(Math.random() * cells);
    const kind = generator.spawnKind === "spike" ? "spike" : "platform";
    spawnFallingObject({
      kind,
      x: generator.x + cell * TILE,
      y: generator.y,
      w: kind === "platform" ? platformLength * TILE : TILE,
      speed: generator.speed,
      source: "platformGenerator",
    });
  }
}

function updateDropBosses(dt) {
  const { room } = state;
  for (const boss of room.dropBosses || []) {
    if (boss.defeated) continue;
    boss.hitCooldown = Math.max(0, (boss.hitCooldown || 0) - dt);
    if (boss.phase) {
      updateDropBossPhase(boss, dt);
      continue;
    }
    boss.pauseTimer = Math.max(0, (boss.pauseTimer || 0) - dt);
    if (!boss.enabled) continue;
    updateDropBossMovement(boss, dt);
    if (boss.pauseTimer > 0) continue;
    boss.timer = (boss.timer || 0) - dt;
    if (boss.timer <= 0) {
      boss.timer += boss.interval;
      queueBossDrop(boss);
    }
    for (const warning of boss.warnings || []) {
      warning.timer -= dt;
      if (warning.timer <= 0) spawnFallingObject({
        kind: warning.kind,
        x: warning.x,
        y: warning.y,
        speed: boss.fallSpeed,
        source: "dropBoss",
        maxAge: 15,
      });
    }
    boss.warnings = (boss.warnings || []).filter((warning) => warning.timer > 0);
  }
}

function dropBossPhaseActive(room) {
  return (room.dropBosses || []).some((boss) => boss.phase && !boss.defeated);
}

function updateDropBossPhase(boss, dt) {
  boss.phase.timer -= dt;
  for (const warning of boss.warnings || []) warning.timer = Math.max(0, boss.phase.timer);
  if (boss.phase.timer > 0) return;
  if (boss.phase.state === "warning") {
    spawnDropBossPhaseGarbage(boss);
    boss.phase.state = "fall";
    boss.phase.timer = 0.45;
    return;
  }
  boss.phase.cycle += 1;
  if (boss.phase.cycle >= 2) {
    clearDropBossArenaObjects();
    boss.phase = null;
    boss.pauseTimer = 0;
    boss.timer = boss.interval;
    for (const generator of state.room.platformGenerators || []) generator.timer = 0;
    return;
  }
  queueDropBossBottomWarnings(boss);
}

function startDropBossPhase(boss) {
  clearDropBossArenaObjects();
  boss.pauseTimer = 0;
  boss.timer = boss.interval;
  boss.phase = { state: "warning", cycle: 0, timer: boss.warningTime || 3, warnings: [] };
  queueDropBossBottomWarnings(boss);
}

function queueDropBossBottomWarnings(boss) {
  const { room } = state;
  const cols = Math.max(1, Math.floor(room.width / TILE));
  const y = Math.max(0, room.height - TILE * 2);
  const warnings = [];
  for (let col = 0; col < cols; col += 1) {
    if (col % 3 === 1 && Math.random() < 0.65) continue;
    const kind = randomBossDropKind();
    const width = kind === "lightning" ? TILE * 2 : TILE;
    warnings.push({
      x: Math.min(col * TILE, room.width - width),
      y,
      kind,
      timer: boss.warningTime || 3,
      duration: boss.warningTime || 3,
      phase: true,
    });
  }
  boss.phase.state = "warning";
  boss.phase.timer = boss.warningTime || 3;
  boss.phase.warnings = warnings;
  boss.warnings = warnings;
}

function spawnDropBossPhaseGarbage(boss) {
  for (const warning of boss.phase?.warnings || []) {
    spawnFallingObject({
      kind: warning.kind,
      x: warning.x,
      y: warning.y,
      speed: boss.fallSpeed,
      source: "dropBoss",
      maxAge: 15,
    });
  }
  boss.warnings = [];
}

function clearDropBossArenaObjects() {
  const { room } = state;
  for (const object of room.fallingObjects || []) {
    if (object.source === "dropBoss" || object.source === "platformGenerator") object.dead = true;
  }
  room.fallingObjects = (room.fallingObjects || []).filter((object) => !object.dead);
  room.platforms = (room.platforms || []).filter((platform) => !platform.generated || !platform.dead);
  for (const boss of room.dropBosses || []) boss.warnings = [];
}

function updateDropBossMovement(boss, dt) {
  const zone = boss.moveZone || { x: 0, w: state.room.width };
  const minX = zone.x;
  const maxX = Math.max(minX, zone.x + zone.w - boss.w);
  boss.moveTimer = (boss.moveTimer || 0) - dt;
  if (boss.moveTimer <= 0) {
    boss.moveTimer = 0.7 + Math.random() * 1.4;
    boss.direction = Math.random() < 0.25 ? 0 : (Math.random() < 0.5 ? -1 : 1);
  }
  boss.x += (boss.direction || 0) * boss.moveSpeed * dt;
  if (boss.x <= minX) {
    boss.x = minX;
    boss.direction = Math.random() < 0.35 ? 0 : 1;
  } else if (boss.x >= maxX) {
    boss.x = maxX;
    boss.direction = Math.random() < 0.35 ? 0 : -1;
  }
}

function queueBossDrop(boss) {
  const zone = dropBossDropZone(boss);
  const cols = Math.max(1, Math.floor(zone.w / TILE));
  const bossCenter = boss.x + boss.w / 2;
  const roomCenter = state.room.width / 2;
  let minCol = 0;
  let maxCol = cols - 1;
  if (bossCenter < roomCenter - TILE && Math.random() < 0.7) maxCol = Math.max(0, Math.floor(cols * 0.62));
  if (bossCenter > roomCenter + TILE && Math.random() < 0.7) minCol = Math.min(cols - 1, Math.floor(cols * 0.38));
  const col = minCol + Math.floor(Math.random() * (maxCol - minCol + 1));
  const rowCount = Math.max(1, Math.floor(zone.h / TILE));
  const row = Math.floor(Math.random() * rowCount);
  const kind = randomBossDropKind();
  const warningWidth = kind === "lightning" ? TILE * 2 : TILE;
  boss.warnings ||= [];
  boss.warnings.push({
    x: Math.min(zone.x + col * TILE, state.room.width - warningWidth),
    y: zone.y + row * TILE,
    kind,
    timer: boss.warningTime,
    duration: boss.warningTime,
  });
}

function dropBossDropZone(boss) {
  const x = Math.max(0, Math.min(state.room.width - TILE, boss.x));
  const y = Math.max(0, Math.min(state.room.height - TILE, boss.y + boss.h));
  return {
    x,
    y,
    w: Math.max(TILE, Math.min(boss.w, state.room.width - x)),
    h: Math.max(TILE, state.room.height - y),
  };
}

function randomBossDropKind() {
  const roll = Math.random();
  if (roll < 0.01) return "coin";
  if (roll < 0.11) return "lightning";
  if (roll < 0.25) return "anchor";
  if (roll < 0.41) return "wall";
  if (roll < 0.56) return "breakable";
  if (roll < 0.72) return "spike";
  if (roll < 0.86) return "enemy";
  return "plague";
}

function spawnFallingObject({ kind, x, y, w, speed, source, maxAge }) {
  const { room } = state;
  room.fallingObjects ||= [];
  const width = Math.max(TILE, w || (kind === "lightning" ? TILE * 2 : TILE));
  const maxX = Math.max(0, room.width - width);
  const object = {
    id: `fall:${Date.now()}:${Math.random()}`,
    kind,
    x: Math.max(0, Math.min(x, maxX)),
    y,
    w: width,
    h: kind === "platform" || kind === "breakable" ? TILE / 2 : TILE,
    vy: Math.max(0.1, speed || TILE * 2),
    solid: kind === "wall",
    face: "up",
    moving: kind === "platform" || kind === "breakable",
    generated: true,
    source,
    age: 0,
    maxAge: Number.isFinite(maxAge) ? maxAge : null,
  };
  if (kind === "platform" || kind === "breakable") room.platforms.push(object);
  room.fallingObjects.push(object);
}

function fallingLightningHazard(object) {
  return {
    a: { x: object.x + 10, y: object.y + object.h / 2 },
    b: { x: object.x + object.w - 10, y: object.y + object.h / 2 },
  };
}

function updateFallingObjects(dt) {
  const { room, player } = state;
  for (const object of room.fallingObjects || []) {
    if (object.dead) continue;
    object.age = (object.age || 0) + dt;
    if (object.maxAge !== null && object.age >= object.maxAge) {
      object.dead = true;
      continue;
    }
    const previous = { x: object.x, y: object.y, w: object.w, h: object.h };
    const carrier = findCarrierPlatform(object);
    if (carrier) {
      object.x += carrier.lastDx || 0;
      object.y = carrier.y - object.h + (carrier.lastDy || 0);
      object.vy = Math.max(0, carrier.lastDy ? (carrier.lastDy / Math.max(dt, 0.001)) : 0);
    } else {
      object.y += object.vy * dt;
    }
    const dx = object.x - previous.x;
    const dy = object.y - previous.y;
    object.lastDx = dx;
    object.lastDy = dy;
    if ((object.kind === "platform" || object.kind === "breakable") && isStandingOn(player, previous)) {
      player.x += dx;
      player.y += dy;
    }
    if (object.y > room.height + TILE * 3) object.dead = true;
  }
  room.fallingObjects = (room.fallingObjects || []).filter((object) => !object.dead);
  room.platforms = (room.platforms || []).filter((platform) => !platform.generated || !platform.dead);
}

function findCarrierPlatform(object) {
  const foot = { x: object.x + 3, y: object.y + object.h, w: object.w - 6, h: 3 };
  for (const platform of state.room.platforms || []) {
    if (platform === object || platform.dead) continue;
    if ((platform.face || "up") !== "up") continue;
    if (rectsOverlap(foot, platform)) return platform;
  }
  for (const block of activeBlocks(state)) {
    if (block === object) continue;
    if (rectsOverlap(foot, block)) return { ...block, lastDx: 0, lastDy: 0 };
  }
  return null;
}

function isStandingOn(actor, platform) {
  return actor.y + actor.h <= platform.y + 5 &&
    actor.y + actor.h >= platform.y - 6 &&
    actor.x + actor.w > platform.x + 3 &&
    actor.x < platform.x + platform.w - 3 &&
    actor.vy >= -20;
}

function protectSideHazard(player, side) {
  if (state.form !== "none" || player.rollTimer > 0 || side === 0) return false;
  player.sideHazardContactThisFrame = true;
  if (!player.sideHazardLatched) {
    player.sideHazardLatched = true;
    player.sideHazardGrace = SIDE_HAZARD_GRACE;
    player.sideHazardSide = side;
  }
  return player.sideHazardGrace > 0;
}

function rectHazardSide(player, hazard) {
  const overlapX = Math.min(player.x + player.w, hazard.x + hazard.w) - Math.max(player.x, hazard.x);
  const overlapY = Math.min(player.y + player.h, hazard.y + hazard.h) - Math.max(player.y, hazard.y);
  if (overlapX <= 0 || overlapY <= 0 || overlapX > overlapY) return 0;
  return player.x + player.w / 2 < hazard.x + hazard.w / 2 ? 1 : -1;
}

function plagueHazardSide(player, plague, radius) {
  const ys = [player.y + 4, player.y + player.h / 2, player.y + player.h - 4];
  const left = ys.some((y) => touchesPlague(player.x, y, plague, radius));
  const right = ys.some((y) => touchesPlague(player.x + player.w, y, plague, radius));
  return left === right ? 0 : left ? -1 : 1;
}

function segmentHazardSide(player, a, b, radius) {
  const left = segmentsIntersect(a, b, { x: player.x, y: player.y }, { x: player.x, y: player.y + player.h }) ||
    pointNearSegment(player.x, player.y + player.h / 2, a, b) < radius;
  const right = segmentsIntersect(a, b, { x: player.x + player.w, y: player.y }, { x: player.x + player.w, y: player.y + player.h }) ||
    pointNearSegment(player.x + player.w, player.y + player.h / 2, a, b) < radius;
  return left === right ? 0 : left ? -1 : 1;
}

function insetSegment(a, b, amount) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= amount * 2) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    a: { x: a.x + ux * amount, y: a.y + uy * amount },
    b: { x: b.x - ux * amount, y: b.y - uy * amount },
  };
}

function rectTouchesSegment(rect, a, b, padding = 0) {
  const left = rect.x - padding;
  const right = rect.x + rect.w + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.h + padding;
  const inside = (point) =>
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (inside(a) || inside(b)) return true;
  const edges = [
    [{ x: left, y: top }, { x: right, y: top }],
    [{ x: right, y: top }, { x: right, y: bottom }],
    [{ x: right, y: bottom }, { x: left, y: bottom }],
    [{ x: left, y: bottom }, { x: left, y: top }],
  ];
  return edges.some(([c, d]) => segmentsIntersect(a, b, c, d));
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) =>
    q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x) &&
    q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && onSegment(a, c, b)) return true;
  if (abD === 0 && onSegment(a, d, b)) return true;
  if (cdA === 0 && onSegment(c, a, d)) return true;
  if (cdB === 0 && onSegment(c, b, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
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

function rectTouchesPlague(rect, plague, radius) {
  const inset = 3;
  const points = [
    [rect.x + rect.w / 2, rect.y + rect.h / 2],
    [rect.x + inset, rect.y + inset],
    [rect.x + rect.w - inset, rect.y + inset],
    [rect.x + inset, rect.y + rect.h - inset],
    [rect.x + rect.w - inset, rect.y + rect.h - inset],
    [rect.x + rect.w / 2, rect.y + rect.h],
    [rect.x + rect.w / 2, rect.y],
  ];
  return points.some(([x, y]) => touchesPlague(x, y, plague, radius));
}

function handleSwitches(dt = 0) {
  const { room, player } = state;
  const bodyCanPress = !(state.form === "green" && player.greenAfterimage);
  for (const s of room.switches || []) {
    const body = bodyCanPress && rectsOverlap(player, s);
    const grave = player.graves.some((g) => rectsOverlap({ x: g.x, y: g.y, w: 28, h: 32 }, s));
    const isFinalBossSwitch = room.bossRoom && s.switchKey === "8,38";
    if (isFinalBossSwitch) {
      if (room.bossDefeated && !body) room.finalSwitchArmed = true;
      if (room.bossDefeated && room.finalSwitchArmed && body) {
        s.latched = true;
        room.bossCleared = true;
        state.clearedBossRooms.add(room.id);
      }
      s.pressed = Boolean(s.latched);
    } else {
      if (body || grave) s.latched = true;
      s.pressed = body || grave || s.latched;
    }
  }
  for (const s of room.repeatSwitches || []) {
    const body = bodyCanPress && rectsOverlap(player, s);
    const grave = player.graves.some((g) => rectsOverlap({ x: g.x, y: g.y, w: 28, h: 32 }, s));
    const overlapping = body || grave;
    if (overlapping && !s.wasOverlapping) s.pressed = !s.pressed;
    s.wasOverlapping = overlapping;
  }
  for (const s of room.leverSwitches || []) {
    const overlapping = rectsOverlap(player, s);
    if (!overlapping) {
      s.lastSide = null;
      continue;
    }
    const side = leverSide(player, s);
    const opposite = oppositeSide(s.initialSide || "right");
    if (s.lastSide === (s.initialSide || "right") && side === opposite) s.pressed = !s.pressed;
    s.lastSide = side;
  }
  for (const trigger of room.hiddenTriggers || []) {
    const body = bodyCanPress && rectsOverlap(player, trigger);
    const grave = player.graves.some((g) => rectsOverlap({ x: g.x, y: g.y, w: 28, h: 32 }, trigger));
    const overlapping = body || grave;
    if (trigger.once && overlapping) trigger.latched = true;
    trigger.pressed = trigger.once ? trigger.latched : overlapping;
  }

  const switchStates = new Map();
  for (const item of [
    ...(room.switches || []),
    ...(room.repeatSwitches || []),
    ...(room.leverSwitches || []),
    ...(room.hiddenTriggers || []),
  ]) {
    switchStates.set(item.switchKey, Boolean(item.pressed));
  }
  const targetControllers = new Map();
  for (const binding of room.controlBindings || []) {
    const key = `${binding.switch?.x},${binding.switch?.y}`;
    for (const target of binding.targets || []) {
      const targetKey = targetKeyForControlTarget(target);
      if (!targetControllers.has(targetKey)) targetControllers.set(targetKey, []);
      targetControllers.get(targetKey).push(Boolean(switchStates.get(key)));
    }
  }
  const targetForces = new Map();
  updateSequencers(room, switchStates, targetControllers, targetForces, dt);
  const targetActive = (key) => {
    if (targetForces.has(key)) return Boolean(targetForces.get(key));
    const controllers = targetControllers.get(key);
    return Boolean(controllers?.length) && controllers.every(Boolean);
  };
  const targetControlled = (key) => Boolean(targetControllers.get(key)?.length);
  const targetEnabled = (key, fallback = true) => {
    const defaultEnabled = room.targetDefaults?.[key] ?? fallback;
    if (!targetControlled(key)) return Boolean(defaultEnabled);
    return defaultEnabled ? !targetActive(key) : targetActive(key);
  };

  for (const gate of room.gates || []) {
    let shouldOpen = targetActive(gate.targetKey);
    if (room.bossRoom) {
      const gx = Math.floor(gate.x / TILE);
      const gy = Math.floor(gate.y / TILE);
      const bossGate = (gx === 38 && gy >= 8 && gy <= 11) || (gy === 38 && gx >= 4 && gx <= 7);
      if (bossGate) shouldOpen = room.bossCleared || (!room.bossBattleStarted && gx === 38);
      if (bossGate && room.bossBattleStarted && !room.bossCleared) {
        gate.openAmount = 0;
        gate.open = false;
        continue;
      }
    }
    gate.openAmount += ((shouldOpen ? 1 : 0) - gate.openAmount) * Math.min(1, dt * 8);
    gate.open = shouldOpen || gate.openAmount > 0.001;
  }
  for (const hazard of room.hazards || []) {
    if (hazard.type === "spike") hazard.disabled = targetActive(hazard.targetKey);
  }
  for (const plague of room.plagueHazards || []) {
    if (plague.targetKey) plague.disabled = !targetEnabled(plague.targetKey, true);
  }
  for (const coin of room.coins || []) {
    coin.disabled = targetControlled(coin.targetKey) && !targetActive(coin.targetKey);
  }
  room.lightningDisabled = false;
  for (const segment of room.lightningSegments || []) {
    segment.disabled = !targetEnabled(segment.targetKey, true);
  }
  for (const emitter of room.emitters || []) {
    emitter.disabled = room.bossDefeated || !targetEnabled(emitter.targetKey, true);
  }
  for (const platform of room.movingPlatforms || []) {
    platform.enabled = targetEnabled(platform.targetKey, true);
  }
  for (const generator of room.platformGenerators || []) {
    generator.enabled = targetEnabled(generator.targetKey, true);
  }
  for (const boss of room.dropBosses || []) {
    boss.enabled = !boss.defeated && targetEnabled(boss.targetKey, true);
  }
}

function targetKeyForControlTarget(target) {
  if (target.type === "lightning") return `lightning:${target.chain},${target.segment}`;
  if (target.type === "plague") {
    const surface = normalizeSurfacePlague(target);
    return surface ? `plague:${surface.x},${surface.y},${surface.face}` : "plague:invalid";
  }
  if (target.type === "emitter") return `emitter:${target.index}`;
  if (target.type === "enemy") return `enemy:${target.index}`;
  if (target.type === "movingPlatform") return `movingPlatform:${target.index}`;
  if (target.type === "platformGenerator") return `platformGenerator:${target.index}`;
  if (target.type === "dropBoss") return `dropBoss:${target.index}`;
  return `cell:${target.x},${target.y}`;
}

function updateSequencers(room, switchStates, targetControllers, targetForces, dt) {
  for (const sequencer of room.sequencers || []) {
    for (const target of sequencerTargets(sequencer)) {
      const key = targetKeyForControlTarget(target);
      if (!targetControllers.has(key)) targetControllers.set(key, []);
      targetControllers.get(key).push(false);
    }
    if (sequencer.finished) continue;
    if (!sequencer.started && sequencer.mode === "conditional") {
      const active = sequencerConditionActive(room, switchStates, sequencer.condition);
      const changed = sequencer.prevCondition !== undefined && active !== sequencer.prevCondition;
      if (sequencer.condition?.type === "pickup" ? active : changed) sequencer.started = true;
      sequencer.prevCondition = active;
    }
    if (!sequencer.started) continue;
    sequencer.timer += dt;
    if (Array.isArray(sequencer.events) && sequencer.events.length) {
      updateEventSequencer(room, sequencer, targetControllers, targetForces);
      continue;
    }
    const interval = Math.max(0.2, Number(sequencer.interval || 1));
    const duration = Math.max(0.05, Number(sequencer.duration || interval));
    const targets = sequencer.targets || [];
    if (!targets.length) continue;
    const total = interval * targets.length;
    if (!sequencer.loop && sequencer.timer >= total) {
      sequencer.finished = true;
      continue;
    }
    const t = sequencer.loop ? sequencer.timer % total : sequencer.timer;
    const index = Math.min(targets.length - 1, Math.floor(t / interval));
    const activeInStep = (t % interval) < duration;
    if (!activeInStep) continue;
    const key = targetKeyForControlTarget(targets[index]);
    targetControllers.get(key).push(true);
  }
}

function sequencerTargets(sequencer) {
  if (Array.isArray(sequencer.events) && sequencer.events.length) {
    return sequencer.events.flatMap((event) => event.targets || []);
  }
  return sequencer.targets || [];
}

function updateEventSequencer(room, sequencer, targetControllers, targetForces) {
  const events = sequencer.events || [];
  const usesAbsoluteTime = events.some((event) => Number.isFinite(Number(event.time)));
  let cursor = 0;
  const timeline = [];
  for (const event of events) {
    if (usesAbsoluteTime) cursor = Math.max(0, Number(event.time || 0));
    else cursor += Math.max(0, Number(event.delay || 0));
    const duration = Math.max(0.05, Number(event.duration || 0.5));
    timeline.push({
      id: event.id || `${cursor}:${duration}:${event.action || "trigger"}`,
      start: cursor,
      end: cursor + duration,
      action: event.action || "trigger",
      targets: event.targets || [],
    });
  }
  const total = Math.max(0.05, timeline.reduce((max, event) => Math.max(max, event.end), 0));
  if (!sequencer.loop && sequencer.timer >= total) {
    sequencer.finished = true;
    return;
  }
  const t = sequencer.loop ? sequencer.timer % total : sequencer.timer;
  for (const event of timeline) {
    if (t < event.start || t >= event.end) continue;
    for (const target of event.targets) {
      const key = targetKeyForControlTarget(target);
      if (event.action === "trigger") targetForces.set(key, true);
      else if (event.action === "release") targetForces.set(key, false);
      else applySequencerInstantAction(room, sequencer, event, target);
    }
  }
}

function applySequencerInstantAction(room, sequencer, event, target) {
  const cycle = Math.floor(sequencer.timer / Math.max(0.05, event.end || 1));
  const key = `${cycle}:${event.id}:${targetKeyForControlTarget(target)}:${event.action}`;
  sequencer.firedActions ||= new Set();
  if (sequencer.firedActions.has(key)) return;
  sequencer.firedActions.add(key);
  if (target.type !== "enemy") return;
  const enemy = room.enemies?.[target.index];
  if (!enemy) return;
  if (event.action === "kill") {
    enemy.alive = false;
  } else if (event.action === "revive") {
    enemy.alive = true;
    if (Number.isFinite(enemy.maxHp)) enemy.hp = enemy.maxHp;
  } else if (event.action === "resetPath") {
    enemy.x = enemy.spawnX ?? enemy.x;
    enemy.y = enemy.spawnY ?? enemy.y;
    enemy.pathIndex = enemy.spawnPathIndex || 0;
    enemy.alive = true;
    if (Number.isFinite(enemy.maxHp)) enemy.hp = enemy.maxHp;
  }
}

function sequencerConditionActive(room, switchStates, condition) {
  if (!condition) return false;
  if (condition.type === "trigger") return Boolean(switchStates.get(`${condition.x},${condition.y}`));
  if (condition.type === "pickup") {
    const x = Number(condition.x);
    const y = Number(condition.y);
    return (room.coins || []).some((coin) => Math.floor(coin.x / TILE) === x && Math.floor(coin.y / TILE) === y && coin.taken) ||
      (room.abilityPickups || []).some((item) => Math.floor(item.x / TILE) === x && Math.floor(item.y / TILE) === y && item.taken) ||
      (room.helmet && Math.floor(room.helmet.x / TILE) === x && Math.floor(room.helmet.y / TILE) === y && room.helmet.taken);
  }
  return false;
}

function updateBreakablePlatforms(dt) {
  const { room, player } = state;
  for (const platform of room.breakablePlatforms || []) {
    if (platform.broken) {
      platform.restoreTime -= dt;
      if (platform.restoreTime <= 0) {
        platform.broken = false;
        platform.standTime = 0;
      }
      continue;
    }
    const rect = transformedRect(state, platform);
    const playerStanding = Math.abs(player.y + player.h - rect.y) <= 3 &&
      player.x + player.w > rect.x + 2 &&
      player.x < rect.x + rect.w - 2 &&
      player.vy >= 0;
    const graveStanding = player.graves.some((grave) =>
      Math.abs(grave.y + 32 - rect.y) <= 3 &&
      grave.x + 28 > rect.x + 2 &&
      grave.x < rect.x + rect.w - 2
    );
    const standing = playerStanding || graveStanding;
    platform.standTime = standing ? platform.standTime + dt : Math.max(0, platform.standTime - dt * 2);
    if (platform.standTime >= 2) {
      platform.broken = true;
      platform.restoreTime = 8;
      platform.standTime = 0;
    }
  }
}

function leverSide(player, lever) {
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;
  const lx = lever.x + lever.w / 2;
  const ly = lever.y + lever.h / 2;
  if (lever.initialSide === "up" || lever.initialSide === "down") return py < ly ? "up" : "down";
  return px < lx ? "left" : "right";
}

function oppositeSide(side) {
  return { left: "right", right: "left", up: "down", down: "up" }[side] || "left";
}

function handleCheckpoints() {
  const { room, player } = state;
  for (const cp of room.checkpoints || []) {
    if (!rectsOverlap(player, cp)) continue;
    cp.active = true;
    state.checkpoint = {
      roomIndex: state.roomIndex,
      x: cp.x + cp.w / 2 - player.w / 2,
      y: cp.y + cp.h - player.h,
      key: `checkpoint:${room.id}:${cp.x},${cp.y}`,
      form: state.form,
      helmetOwned: state.helmetOwned,
      unlockedForms: [...state.unlockedForms],
      worldRot: state.worldRot,
    };
  }
}

function handleEnemies() {
  const { room, player } = state;
  for (const enemy of room.enemies || []) {
    if (!enemy.alive) continue;
    if (canWhiteKill(enemy) || canGreenLineKill(enemy)) {
      damageEnemy(enemy, 1);
      continue;
    }
    if (!rectsOverlap(player, enemy)) continue;
    const blackStomp = state.form === "black" && player.vy > 120 && player.y + player.h <= enemy.y + 12;
    if (state.form === "red" && player.redDash) {
      damageEnemy(enemy, 1);
      player.redQteBonus = Math.min(0.28, player.redQteBonus + 0.16);
    } else if (blackStomp) {
      damageEnemy(enemy, 1);
      player.vy = Math.min(player.vy, -360);
    } else if (player.rollTimer > 0) {
      refreshRoll(player);
    } else {
      respawn("enemy");
      return;
    }
  }
  for (const object of room.fallingObjects || []) {
    if (object.dead || object.kind !== "enemy") continue;
    if (!rectsOverlap(player, object)) continue;
    if (state.form === "red" && player.redDash) {
      object.dead = true;
      player.redQteBonus = Math.min(0.28, player.redQteBonus + 0.16);
    } else if (player.rollTimer > 0) {
      refreshRoll(player);
    } else {
      respawn("enemy");
      return;
    }
  }
}

function damageEnemy(enemy, amount = 1) {
  if (!enemy.advanced) {
    enemy.alive = false;
    return;
  }
  if (enemy.damageCooldown > 0) return;
  enemy.hp = Math.max(0, Number(enemy.hp ?? enemy.maxHp ?? 1) - amount);
  enemy.damageCooldown = 0.25;
  if (enemy.hp <= 0) enemy.alive = false;
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
  if (player.rollRefreshSoundCooldown <= 0) {
    player.rollRefreshSoundCooldown = ROLL_REFRESH_SOUND_INTERVAL;
    player.rollRefreshQueued = true;
  }
}

function updateEnemyPatrols(dt) {
  for (const enemy of state.room.enemies || []) {
    enemy.damageCooldown = Math.max(0, (enemy.damageCooldown || 0) - dt);
    if (!enemy.alive) continue;
    if (enemy.path) {
      updatePathMover(enemy, dt);
      continue;
    }
    if (!enemy.patrol?.axis) continue;
    const patrol = enemy.patrol;
    const axis = patrol.axis;
    enemy[axis] += patrol.direction * patrol.speed * dt;
    const min = axis === "x" ? patrol.minX : patrol.minY;
    const max = axis === "x" ? patrol.maxX : patrol.maxY;
    if (enemy[axis] <= min) {
      enemy[axis] = min;
      patrol.direction = 1;
    } else if (enemy[axis] >= max) {
      enemy[axis] = max;
      patrol.direction = -1;
    }
  }
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
  const size = currentRoomSize();
  if (state.overallPlaytest) {
    if (player.x <= 0 && player.vx < 0) {
      if (!changeRoom("l")) player.x = 0;
    } else if (player.x + player.w >= size.width && player.vx > 0) {
      if (!changeRoom("r")) player.x = size.width - player.w;
    }
    if (player.y <= 0 && player.vy < 0) {
      if (!changeRoom("u")) {
        player.y = 0;
        player.vy = Math.max(0, player.vy);
      }
    } else if (player.y + player.h >= size.height && player.vy > 0) {
      if (!changeRoom("d")) {
        player.y = size.height - player.h;
        player.vy = Math.min(0, player.vy);
        player.onGround = true;
        player.jumps = 0;
      }
    }
    return;
  }
  if (player.x <= 0 && inSideExit("l")) {
    if (!changeRoom("l")) player.x = 0;
  } else if (player.x + player.w >= size.width && inSideExit("r")) {
    if (!changeRoom("r")) player.x = size.width - player.w;
  }
  if (player.y <= 0 && inTopExit()) {
    if (!changeRoom("u")) player.y = 0;
  } else if (player.y + player.h >= size.height && inBottomExit()) {
    if (!changeRoom("d")) player.y = size.height - player.h;
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
  if (event.code === "Escape" && state.mapOpen) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("mousedown", (event) => {
  if (!state.mapOpen || event.button !== 0) return;
  event.preventDefault();
  const point = canvasPoint(event);
  mapDrag = { x: point.x, y: point.y, panX: state.mapPan.x, panY: state.mapPan.y };
  canvas.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (event) => {
  if (!mapDrag) return;
  const point = canvasPoint(event);
  state.mapPan.x = mapDrag.panX + point.x - mapDrag.x;
  state.mapPan.y = mapDrag.panY + point.y - mapDrag.y;
});

window.addEventListener("mouseup", () => {
  if (!mapDrag) return;
  mapDrag = null;
  canvas.style.cursor = state.mapOpen ? "grab" : "default";
});

canvas.addEventListener("wheel", (event) => {
  if (!state.mapOpen) return;
  event.preventDefault();
  state.mapPan.x -= event.shiftKey ? event.deltaY : event.deltaX;
  state.mapPan.y -= event.shiftKey ? 0 : event.deltaY;
}, { passive: false });

async function bootstrap() {
  try {
    if (!setupEditorWorldPlaytest() && !setupEditorPlaytest() && !await loadExportedWorld()) loadRoom(0);
  } catch (error) {
    console.error("Game data failed to load", error);
    state.worldRooms = worldRooms;
    state.roomIndexById = new Map(worldRooms.map((room, index) => [room.id, index]));
    state.overallPlaytest = false;
    state.form = "none";
    state.helmetOwned = false;
    state.unlockedForms = new Set();
    loadRoom(0);
  }
  requestAnimationFrame(frame);
}

bootstrap();

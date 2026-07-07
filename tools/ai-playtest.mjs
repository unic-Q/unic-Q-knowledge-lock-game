import { worldRooms } from "../src/world.js";
import { COLS, ROOM_FLOOR, ROWS } from "../src/constants.js";
import { writeFileSync } from "node:fs";

const MAX_EVALUATIONS = 500;
const CLEAR_REWARD = 10000;
const OBJECTIVE_REWARD = CLEAR_REWARD / 2;
const WALK_REWARD = 0.08;
const JUMP_REWARD = 0.22;
const POPULATION = 25;
const GENERATIONS = Math.ceil(MAX_EVALUATIONS / POPULATION);
const STEPS = 100;
const ACTIONS = [
  "left",
  "left_jump",
  "right",
  "right_jump",
  "jump",
  "roll",
  "red_dash",
  "green_spirit",
  "green_grave",
  "white_attach",
  "white_hook",
  "black_erode",
  "black_rotate",
  "wait",
];

const FEATURE_COUNT = 16;
const ELITE_COUNT = 5;
const MUTATION = 0.22;
let seed = 20260707;

function seedFor(roomId, mode) {
  let value = 20260707 + roomId * 1009;
  for (const ch of mode) value = (value * 33 + ch.charCodeAt(0)) >>> 0;
  seed = value >>> 0;
}

function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function gauss() {
  const u = Math.max(0.0001, rand());
  const v = Math.max(0.0001, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeBrain() {
  return Array.from({ length: ACTIONS.length }, () => (
    Array.from({ length: FEATURE_COUNT }, () => gauss() * 0.35)
  ));
}

function cloneBrain(brain) {
  return brain.map((row) => [...row]);
}

function mutate(brain) {
  const next = cloneBrain(brain);
  for (const row of next) {
    for (let i = 0; i < row.length; i += 1) {
      if (rand() < MUTATION) row[i] += gauss() * 0.28;
    }
  }
  return next;
}

function crossover(a, b) {
  return a.map((row, y) => row.map((value, x) => (rand() < 0.5 ? value : b[y][x])));
}

function roomGrid(room) {
  return room.blocks.map((row) => [...row]);
}

function solid(grid, x, y, eroded = new Set()) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const key = `${x},${y}`;
  if (eroded.has(key)) return false;
  return "#=DHE".includes(grid[y][x]);
}

function deadly(grid, x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  return "!~P".includes(grid[y][x]);
}

function findCells(grid, chars) {
  const cells = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (chars.includes(grid[y][x])) cells.push({ x, y, c: grid[y][x] });
    }
  }
  return cells;
}

function makeEnv(roomId) {
  const room = worldRooms[roomId - 1];
  const grid = roomGrid(room);
  const exits = [];
  const entries = [];
  for (let y = 1; y < ROWS - 1; y += 1) {
    if (grid[y][0] === ".") entries.push({ x: 1, y });
  }
  for (let y = 1; y < ROWS - 1; y += 1) {
    if (grid[y][COLS - 1] === ".") exits.push({ x: COLS - 1, y });
  }
  const ability = findCells(grid, "RGWB")[0] || null;
  const switches = findCells(grid, "K");
  const enemies = findCells(grid, "M");
  const erodes = findCells(grid, "E");
  const gates = findCells(grid, "D");
  return {
    room,
    grid,
    exits,
    ability,
    switches,
    enemies,
    erodes,
    gates,
    start: entries[entries.length - 1] || { x: 2, y: ROOM_FLOOR - 1 },
  };
}

function makeObjectives(env, mode) {
  const objectives = [];
  for (const cell of env.switches.slice(0, 3)) {
    objectives.push({ id: `switch:${cell.x},${cell.y}`, type: "switch", x: cell.x, y: cell.y, label: "Press switch" });
  }
  if (mode === "helmet" && env.ability && objectives.length < 3) {
    objectives.push({ id: `ability:${env.ability.x},${env.ability.y}`, type: "ability", x: env.ability.x, y: env.ability.y, label: `Collect ${env.ability.c}` });
  }
  return objectives;
}

function nearestDistance(x, y, cells) {
  if (!cells.length) return 12;
  return Math.min(...cells.map((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y)));
}

function features(state, env) {
  const below = solid(env.grid, state.x, state.y + 1, state.eroded) ? 1 : 0;
  const ahead = solid(env.grid, state.x + 1, state.y, state.eroded) ? 1 : 0;
  const aheadBelow = solid(env.grid, state.x + 1, state.y + 1, state.eroded) ? 1 : 0;
  const hazardAhead = deadly(env.grid, state.x + 1, state.y) || deadly(env.grid, state.x + 1, state.y + 1) ? 1 : 0;
  const exit = env.exits[0] || { x: COLS - 1, y: ROOM_FLOOR - 1 };
  return [
    1,
    state.x / COLS,
    state.y / ROWS,
    (exit.x - state.x) / COLS,
    (exit.y - state.y) / ROWS,
    below,
    ahead,
    aheadBelow,
    hazardAhead,
    nearestDistance(state.x, state.y, env.switches) / 12,
    nearestDistance(state.x, state.y, env.enemies) / 12,
    nearestDistance(state.x, state.y, env.erodes) / 12,
    state.hasRed ? 1 : 0,
    state.hasGreen ? 1 : 0,
    state.hasWhite ? 1 : 0,
    state.hasBlack ? 1 : 0,
  ];
}

function actionAllowed(name, state, mode) {
  if (name === "roll") return mode === "no-helmet" && state.rollCd <= 0;
  if (name === "red_dash") return state.hasRed && state.redCd <= 0;
  if (name === "green_spirit" || name === "green_grave") return state.hasGreen;
  if (name === "white_attach") return state.hasWhite && state.whiteCd <= 0;
  if (name === "white_hook") return state.hasWhite && state.whiteCd <= 0;
  if (name === "black_erode" || name === "black_rotate") return state.hasBlack && state.blackCd <= 0;
  return true;
}

function chooseAction(brain, q, key, xs, epsilon, mode, state) {
  const allowed = ACTIONS.map((name, index) => ({ name, index }))
    .filter((action) => actionAllowed(action.name, state, mode));
  if (rand() < epsilon) return allowed[Math.floor(rand() * allowed.length)].index;
  let best = 0;
  let bestScore = -Infinity;
  for (let a = 0; a < ACTIONS.length; a += 1) {
    if (!actionAllowed(ACTIONS[a], state, mode)) continue;
    const linear = brain[a].reduce((sum, w, i) => sum + w * xs[i], 0);
    const learned = q.get(`${key}|${a}`) || 0;
    const score = linear + learned;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function stateKey(state) {
  return `${Math.floor(state.x / 3)},${Math.floor(state.y / 3)},${state.hasRed ? 1 : 0}${state.hasGreen ? 1 : 0}${state.hasWhite ? 1 : 0}${state.hasBlack ? 1 : 0}`;
}

function tryMove(state, env, dx, dy) {
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  for (let i = 0; i < steps; i += 1) {
    const nx = Math.max(1, Math.min(COLS - 1, state.x + (i < Math.abs(dx) ? sx : 0)));
    const ny = Math.max(1, Math.min(ROWS - 1, state.y + (i < Math.abs(dy) ? sy : 0)));
    if (solid(env.grid, nx, ny, state.eroded)) return;
    state.x = nx;
    state.y = ny;
  }
}

function applyAction(state, env, action, mode) {
  const name = ACTIONS[action];
  if (name === "left") tryMove(state, env, -1, 0);
  if (name === "left_jump") {
    tryMove(state, env, -1, 0);
    if (solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, -2);
  }
  if (name === "right") tryMove(state, env, 1, 0);
  if (name === "right_jump") {
    tryMove(state, env, 1, 0);
    if (solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, -2);
  }
  if (name === "jump" && solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, -2);
  if (name === "roll" && mode === "no-helmet" && state.rollCd <= 0) {
    tryMove(state, env, 2, 0);
    state.rollCd = 12;
  }
  if (name === "red_dash" && state.hasRed && state.redCd <= 0) {
    tryMove(state, env, 4, 0);
    state.redCd = 10;
  }
  if (name === "green_spirit" && state.hasGreen) {
    if (state.spirit && state.grave) {
      state.x = state.grave.x;
      state.y = state.grave.y;
      state.spirit = false;
    }
  }
  if (name === "green_grave" && state.hasGreen) {
    state.grave = { x: state.x, y: state.y };
    state.spirit = true;
  }
  if (name === "white_attach" && state.hasWhite && state.whiteCd <= 0) {
    tryMove(state, env, 2, -1);
    state.whiteCd = 14;
  }
  if (name === "white_hook" && state.hasWhite && state.whiteCd <= 0) {
    tryMove(state, env, 3, -2);
    state.whiteCd = 18;
  }
  if (name === "black_erode" && state.hasBlack && state.blackCd <= 0) {
    const targets = [[state.x, state.y + 1], [state.x + 1, state.y + 1], [state.x, state.y]];
    for (const [x, y] of targets) {
      if (env.grid[y]?.[x] === "E") state.eroded.add(`${x},${y}`);
    }
    state.blackCd = 18;
  }
  if (name === "black_rotate" && state.hasBlack && state.blackCd <= 0) {
    tryMove(state, env, 0, 1);
    state.blackCd = 16;
  }

  if (!state.spirit && !solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, 1);
}

function updateInteractions(state, env, mode) {
  const cell = env.grid[state.y]?.[state.x];
  if (mode === "helmet") {
    if (cell === "R") state.hasRed = true;
    if (cell === "G") state.hasGreen = true;
    if (cell === "W") state.hasWhite = true;
    if (cell === "B") state.hasBlack = true;
  }
  if (cell === "K" && (!state.spirit || state.grave) && !state.pressedSwitches.has(`${state.x},${state.y}`)) {
    state.pressedSwitches.add(`${state.x},${state.y}`);
    state.switches += 1;
    for (const gate of env.gates) state.eroded.add(`${gate.x},${gate.y}`);
  }
  if (cell === "M" && (state.hasRed || state.hasBlack) && !state.killedEnemies.has(`${state.x},${state.y}`)) {
    state.killedEnemies.add(`${state.x},${state.y}`);
    state.kills += 1;
  }
}

function completeObjectives(state, env, mode) {
  const completed = [];
  for (const objective of state.objectives) {
    if (state.objectivesDone.has(objective.id)) continue;
    let done = false;
    if (objective.type === "switch") {
      done = state.pressedSwitches.has(`${objective.x},${objective.y}`);
    } else if (objective.type === "ability") {
      done = mode === "helmet" && state.x === objective.x && state.y === objective.y;
    }
    if (done) {
      state.objectivesDone.add(objective.id);
      completed.push(objective);
    }
  }
  return completed;
}

function evaluate(brain, env, mode, inheritedQ = null, options = {}) {
  const objectives = makeObjectives(env, mode);
  const q = inheritedQ ? new Map(inheritedQ) : new Map();
  const state = {
    x: env.start.x,
    y: env.start.y,
    bestX: env.start.x,
    switches: 0,
    kills: 0,
    pressedSwitches: new Set(),
    killedEnemies: new Set(),
    objectives,
    objectivesDone: new Set(),
    lastObjectives: [],
    survivedHazards: new Set(),
    visitedCells: new Map([[`${env.start.x},${env.start.y}`, 1]]),
    currentVisits: 1,
    spirit: false,
    grave: null,
    eroded: new Set(),
    hasRed: mode === "helmet" && env.room.id > 3,
    hasGreen: mode === "helmet" && env.room.id > 6,
    hasWhite: mode === "helmet" && env.room.id > 10,
    hasBlack: mode === "helmet" && env.room.id > 14,
    rollCd: 0,
    redCd: 0,
    whiteCd: 0,
    blackCd: 0,
  };
  let reward = 0;
  let cleared = false;
  const used = new Set();
  const trace = [];

  for (let step = 0; step < STEPS; step += 1) {
    const beforeX = state.x;
    const beforeY = state.y;
    const beforeSwitches = state.switches;
    const beforeKills = state.kills;
    const key = stateKey(state);
    const xs = features(state, env);
    const action = chooseAction(brain, q, key, xs, options.epsilon ?? 0.08, mode, state);
    used.add(ACTIONS[action]);
    applyAction(state, env, action, mode);
    updateInteractions(state, env, mode);
    state.lastObjectives = completeObjectives(state, env, mode);
    state.rollCd = Math.max(0, state.rollCd - 1);
    state.redCd = Math.max(0, state.redCd - 1);
    state.whiteCd = Math.max(0, state.whiteCd - 1);
    state.blackCd = Math.max(0, state.blackCd - 1);

    const actionName = ACTIONS[action];
    const movedX = state.x !== beforeX;
    const movedY = state.y !== beforeY;
    const jumped = actionName.includes("jump");
    let r = -0.03;
    if (movedX) r += Math.abs(state.x - beforeX) * WALK_REWARD;
    if (jumped) r += JUMP_REWARD;
    if (!movedX && !movedY) r -= 0.25;
    if (jumped && !movedX) r -= 0.25;
    if (state.x > state.bestX) {
      state.bestX = state.x;
    }
    if (state.switches > beforeSwitches) r += 30;
    if (state.kills > beforeKills) r += 12;
    if (state.lastObjectives.length) r += state.lastObjectives.length * OBJECTIVE_REWARD;
    let event = "";
    const visitKey = `${state.x},${state.y}`;
    const previousVisits = state.visitedCells.get(visitKey) || 0;
    state.currentVisits = previousVisits + 1;
    state.visitedCells.set(visitKey, state.currentVisits);
    if (previousVisits > 0) {
      r -= previousVisits * previousVisits * 0.18;
      event = "repeat_visit";
    }
    if (state.lastObjectives.length) {
      event = state.lastObjectives.map((objective) => `objective:${objective.type}`).join("+");
    }
    const touchingDeadly = deadly(env.grid, state.x, state.y);
    const survivedDeadly = touchingDeadly && ((ACTIONS[action] === "roll" && mode === "no-helmet") || state.spirit);
    if (touchingDeadly && !survivedDeadly) {
      r -= 220;
      reward += r;
      event = "deadly";
      if (options.recordTrace) trace.push(traceStep(step, state, ACTIONS[action], r, reward, event));
      break;
    } else if (survivedDeadly) {
      const hazardKey = `${state.x},${state.y}`;
      if (!state.survivedHazards.has(hazardKey)) {
        state.survivedHazards.add(hazardKey);
        r += 120;
        event = "survived_deadly";
      } else {
        event = "staying_on_deadly";
      }
    }
    if (state.y >= ROWS - 1) {
      r -= 180;
      reward += r;
      event = "fell";
      if (options.recordTrace) trace.push(traceStep(step, state, ACTIONS[action], r, reward, event));
      break;
    }
    if (env.exits.some((exit) => state.x >= exit.x && state.y === exit.y)) {
      r += CLEAR_REWARD;
      reward += r;
      cleared = true;
      event = "cleared";
      if (options.recordTrace) trace.push(traceStep(step, state, ACTIONS[action], r, reward, event));
      break;
    }
    const nextKey = stateKey(state);
    const nextXs = features(state, env);
    let future = -Infinity;
    for (let a = 0; a < ACTIONS.length; a += 1) {
      const linear = brain[a].reduce((sum, w, i) => sum + w * nextXs[i], 0);
      future = Math.max(future, linear + (q.get(`${nextKey}|${a}`) || 0));
    }
    const qKey = `${key}|${action}`;
    const old = q.get(qKey) || 0;
    q.set(qKey, old + 0.18 * (r + 0.88 * future - old));
    reward += r;
    if (options.recordTrace) trace.push(traceStep(step, state, ACTIONS[action], r, reward, event));
  }
  if (!cleared) {
    reward -= 180;
    if (options.recordTrace) {
      trace.push(traceStep(STEPS, state, "timeout", -180, reward, "timeout"));
    }
  }

  return {
    reward,
    cleared,
    bestX: state.bestX,
    used,
    q,
    trace,
  };
}

function traceStep(step, state, action, rewardDelta, rewardTotal, event) {
  return {
    step,
    action,
    x: state.x,
    y: state.y,
    bestX: state.bestX,
    rewardDelta: Number(rewardDelta.toFixed(2)),
    rewardTotal: Number(rewardTotal.toFixed(2)),
    event,
    visits: state.currentVisits,
    objectivesDone: state.objectivesDone.size,
    objectivesTotal: state.objectives.length,
    objectiveEvents: state.lastObjectives.map((objective) => objective.label),
    spirit: state.spirit,
    switches: state.switches,
    kills: state.kills,
    hasRed: state.hasRed,
    hasGreen: state.hasGreen,
    hasWhite: state.hasWhite,
    hasBlack: state.hasBlack,
    cooldowns: {
      roll: state.rollCd,
      red: state.redCd,
      white: state.whiteCd,
      black: state.blackCd,
    },
    eroded: [...state.eroded],
  };
}

function trainRoom(roomId, mode, collectTrace = false) {
  seedFor(roomId, mode);
  const env = makeEnv(roomId);
  let population = Array.from({ length: POPULATION }, () => ({ brain: makeBrain(), q: new Map() }));
  let best = null;
  let bestClear = null;
  let evaluations = 0;
  let clearAt = null;

  for (let generation = 1; generation <= GENERATIONS; generation += 1) {
    const scored = population.map((agent) => {
      evaluations += 1;
      const result = evaluate(agent.brain, env, mode, agent.q, collectTrace ? { recordTrace: true } : {});
      return { ...agent, ...result };
    }).sort((a, b) => b.reward - a.reward);

    if (!best || scored[0].reward > best.reward) best = scored[0];
    const clear = scored.find((agent) => agent.cleared);
    if (clear && (!bestClear || clear.reward > bestClear.reward)) bestClear = clear;
    if (clear && clearAt === null) clearAt = evaluations - scored.length + scored.indexOf(clear) + 1;
    if (evaluations >= MAX_EVALUATIONS) break;

    const elites = scored.slice(0, ELITE_COUNT);
    population = elites.map((agent) => ({ brain: cloneBrain(agent.brain), q: new Map(agent.q) }));
    while (population.length < POPULATION) {
      const a = elites[Math.floor(rand() * elites.length)];
      const b = elites[Math.floor(rand() * elites.length)];
      population.push({ brain: mutate(crossover(a.brain, b.brain)), q: new Map(a.q) });
    }
  }

  const exit = env.exits[0] || { x: COLS - 1, y: ROOM_FLOOR - 1 };
  const startHeight = env.start.y;
  const exitHeight = exit.y;
  const replayAgent = collectTrace && bestClear ? bestClear : best;
  return {
    roomId,
    mode,
    clearAt,
    bestReward: best.reward,
    bestX: best.bestX,
    progress: best.bestX / (COLS - 1),
    used: [...best.used].join(","),
    objectives: env ? makeObjectives(env, mode) : [],
    startHeight,
    exitHeight,
    sameHeight: Math.abs(startHeight - exitHeight) <= 1,
    grid: collectTrace ? env.grid.map((row) => row.join("")) : undefined,
    start: collectTrace ? env.start : undefined,
    exits: collectTrace ? env.exits : undefined,
    trace: collectTrace ? replayAgent.trace : undefined,
    replayCleared: collectTrace ? replayAgent.cleared : undefined,
    replayReward: collectTrace ? replayAgent.reward : undefined,
    replaySource: collectTrace ? (bestClear ? "cleared-agent" : "best-reward-agent") : undefined,
  };
}

const traceIndex = process.argv.indexOf("--trace");
if (traceIndex >= 0) {
  const roomId = Number(process.argv[traceIndex + 1] || 3);
  const mode = process.argv[traceIndex + 2] || "helmet";
  const result = trainRoom(roomId, mode, true);
  const payload = {
    generatedAt: new Date().toISOString(),
    actions: ACTIONS,
    cols: COLS,
    rows: ROWS,
    maxEvaluations: MAX_EVALUATIONS,
    result,
  };
  writeFileSync("tools/ai-trace.json", JSON.stringify(payload, null, 2));
  console.log(`Wrote tools/ai-trace.json for room ${roomId} ${mode}.`);
  console.log(`best progress=${result.progress.toFixed(2)} clearAt=${result.clearAt ?? "not-cleared"} replayCleared=${result.replayCleared}`);
  process.exit(0);
}

const traceAllIndex = process.argv.indexOf("--trace-all");
if (traceAllIndex >= 0) {
  const fromRoom = Number(process.argv[traceAllIndex + 1] || 3);
  const toRoom = Number(process.argv[traceAllIndex + 2] || 20);
  const results = [];
  for (let roomId = fromRoom; roomId <= toRoom; roomId += 1) {
    for (const mode of ["helmet", "no-helmet"]) {
      const result = trainRoom(roomId, mode, true);
      results.push(result);
      const status = result.clearAt ? `CLEARED@${result.clearAt}` : "not-cleared";
      console.log(`trace room ${String(roomId).padStart(2, "0")} ${mode.padEnd(9)} ${status} objectives=${result.objectives.length}`);
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    actions: ACTIONS,
    cols: COLS,
    rows: ROWS,
    maxEvaluations: MAX_EVALUATIONS,
    objectiveReward: OBJECTIVE_REWARD,
    clearReward: CLEAR_REWARD,
    walkReward: WALK_REWARD,
    jumpReward: JUMP_REWARD,
    results,
  };
  writeFileSync("tools/ai-traces.json", JSON.stringify(payload, null, 2));
  const first = results[0];
  writeFileSync("tools/ai-trace.json", JSON.stringify({
    generatedAt: payload.generatedAt,
    actions: ACTIONS,
    cols: COLS,
    rows: ROWS,
    maxEvaluations: MAX_EVALUATIONS,
    objectiveReward: OBJECTIVE_REWARD,
    clearReward: CLEAR_REWARD,
    walkReward: WALK_REWARD,
    jumpReward: JUMP_REWARD,
    result: first,
  }, null, 2));
  console.log(`Wrote tools/ai-traces.json with ${results.length} replays.`);
  process.exit(0);
}

const traceFirstIndex = process.argv.indexOf("--trace-first-clear");
if (traceFirstIndex >= 0) {
  const fromRoom = Number(process.argv[traceFirstIndex + 1] || 3);
  const toRoom = Number(process.argv[traceFirstIndex + 2] || 20);
  let selected = null;
  for (let roomId = fromRoom; roomId <= toRoom && !selected; roomId += 1) {
    for (const mode of ["helmet", "no-helmet"]) {
      const result = trainRoom(roomId, mode, true);
      const status = result.clearAt ? `CLEARED@${result.clearAt}` : "not-cleared";
      console.log(`room ${String(roomId).padStart(2, "0")} ${mode.padEnd(9)} ${status}`);
      if (result.clearAt) {
        selected = result;
        break;
      }
    }
  }
  if (!selected) {
    console.log("No clear found.");
    process.exit(1);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    actions: ACTIONS,
    cols: COLS,
    rows: ROWS,
    maxEvaluations: MAX_EVALUATIONS,
    result: selected,
  };
  writeFileSync("tools/ai-trace.json", JSON.stringify(payload, null, 2));
  console.log(`Wrote tools/ai-trace.json for first clear: room ${selected.roomId} ${selected.mode}.`);
  process.exit(0);
}

const from = Number(process.argv[2] || 3);
const to = Number(process.argv[3] || 20);
const results = [];
for (let roomId = from; roomId <= to; roomId += 1) {
  results.push(trainRoom(roomId, "helmet"));
  results.push(trainRoom(roomId, "no-helmet"));
}

let tooEasy = false;
for (const r of results) {
  const status = r.clearAt ? `CLEARED@${r.clearAt}` : "not-cleared";
  const height = r.sameHeight ? "same-height" : `height ${r.startHeight}->${r.exitHeight}`;
  if (r.clearAt && r.clearAt <= MAX_EVALUATIONS) tooEasy = true;
  console.log(`room ${String(r.roomId).padStart(2, "0")} ${r.mode.padEnd(9)} ${status} progress=${r.progress.toFixed(2)} ${height} used=${r.used}`);
}

if (tooEasy) {
  console.log("FAIL: at least one room was cleared within 500 neuroevolution/RL evaluations.");
  process.exitCode = 1;
} else {
  console.log("PASS: no tested room was cleared within 500 neuroevolution/RL evaluations.");
}

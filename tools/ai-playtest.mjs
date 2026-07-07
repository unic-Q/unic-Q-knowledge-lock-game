import { worldRooms } from "../src/world.js";
import { COLS, ROOM_FLOOR, ROWS } from "../src/constants.js";

const MAX_EVALUATIONS = 500;
const POPULATION = 25;
const GENERATIONS = Math.ceil(MAX_EVALUATIONS / POPULATION);
const STEPS = 360;
const ACTIONS = [
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
  for (let y = ROOM_FLOOR - 2; y <= ROOM_FLOOR - 1; y += 1) {
    if (grid[y][COLS - 1] === ".") exits.push({ x: COLS - 1, y });
  }
  const ability = findCells(grid, "RGWB")[0] || null;
  const switches = findCells(grid, "K");
  const enemies = findCells(grid, "M");
  const erodes = findCells(grid, "E");
  return {
    room,
    grid,
    exits,
    ability,
    switches,
    enemies,
    erodes,
    start: { x: 2, y: ROOM_FLOOR - 1 },
  };
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

function chooseAction(brain, q, key, xs, epsilon, mode) {
  if (rand() < epsilon) return Math.floor(rand() * ACTIONS.length);
  let best = 0;
  let bestScore = -Infinity;
  for (let a = 0; a < ACTIONS.length; a += 1) {
    if (mode === "helmet" && ACTIONS[a] === "roll") continue;
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
  const nx = Math.max(1, Math.min(COLS - 1, state.x + dx));
  const ny = Math.max(1, Math.min(ROWS - 1, state.y + dy));
  if (!solid(env.grid, nx, ny, state.eroded)) {
    state.x = nx;
    state.y = ny;
  }
}

function applyAction(state, env, action, mode) {
  const name = ACTIONS[action];
  if (name === "right") tryMove(state, env, 1, 0);
  if (name === "right_jump") {
    tryMove(state, env, 1, 0);
    if (solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, -2);
  }
  if (name === "jump" && solid(env.grid, state.x, state.y + 1, state.eroded)) tryMove(state, env, 0, -2);
  if (name === "roll" && mode === "no-helmet") tryMove(state, env, 2, 0);
  if (name === "red_dash" && state.hasRed) tryMove(state, env, 4, 0);
  if (name === "green_spirit" && state.hasGreen) {
    state.spirit = !state.spirit;
    tryMove(state, env, 1, state.spirit ? -1 : 0);
  }
  if (name === "green_grave" && state.hasGreen) {
    state.grave = { x: state.x, y: state.y };
  }
  if (name === "white_attach" && state.hasWhite) tryMove(state, env, 2, -1);
  if (name === "white_hook" && state.hasWhite) tryMove(state, env, 3, -2);
  if (name === "black_erode" && state.hasBlack) {
    const targets = [[state.x, state.y + 1], [state.x + 1, state.y + 1], [state.x, state.y]];
    for (const [x, y] of targets) {
      if (env.grid[y]?.[x] === "E") state.eroded.add(`${x},${y}`);
    }
  }
  if (name === "black_rotate" && state.hasBlack) tryMove(state, env, 0, 1);

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
  if (cell === "K" && (!state.spirit || state.grave)) state.switches += 1;
  if (cell === "M" && (state.hasRed || state.hasBlack)) state.kills += 1;
}

function evaluate(brain, env, mode, inheritedQ = null) {
  const q = inheritedQ ? new Map(inheritedQ) : new Map();
  const state = {
    x: env.start.x,
    y: env.start.y,
    bestX: env.start.x,
    switches: 0,
    kills: 0,
    spirit: false,
    grave: null,
    eroded: new Set(),
    hasRed: mode === "helmet" && env.room.id > 3,
    hasGreen: mode === "helmet" && env.room.id > 6,
    hasWhite: mode === "helmet" && env.room.id > 10,
    hasBlack: mode === "helmet" && env.room.id > 14,
  };
  let reward = 0;
  let cleared = false;
  const used = new Set();

  for (let step = 0; step < STEPS; step += 1) {
    const beforeX = state.x;
    const beforeY = state.y;
    const key = stateKey(state);
    const xs = features(state, env);
    const action = chooseAction(brain, q, key, xs, 0.08, mode);
    used.add(ACTIONS[action]);
    applyAction(state, env, action, mode);
    updateInteractions(state, env, mode);

    let r = (state.x - beforeX) * 0.9 - 0.04;
    if (state.y !== beforeY) r += 0.04;
    if (state.x > state.bestX) {
      r += (state.x - state.bestX) * 1.6;
      state.bestX = state.x;
    }
    if (state.switches) r += 0.6;
    if (state.kills) r += 0.5;
    if (deadly(env.grid, state.x, state.y) && !(ACTIONS[action] === "roll" && mode === "no-helmet") && !state.spirit) {
      r -= 18;
      reward += r;
      break;
    }
    if (state.y >= ROWS - 1) {
      r -= 12;
      reward += r;
      break;
    }
    if (env.exits.some((exit) => Math.abs(exit.x - state.x) <= 1 && Math.abs(exit.y - state.y) <= 1)) {
      r += 80;
      reward += r;
      cleared = true;
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
  }

  return {
    reward,
    cleared,
    bestX: state.bestX,
    used,
    q,
  };
}

function trainRoom(roomId, mode) {
  const env = makeEnv(roomId);
  let population = Array.from({ length: POPULATION }, () => ({ brain: makeBrain(), q: new Map() }));
  let best = null;
  let evaluations = 0;
  let clearAt = null;

  for (let generation = 1; generation <= GENERATIONS; generation += 1) {
    const scored = population.map((agent) => {
      evaluations += 1;
      const result = evaluate(agent.brain, env, mode, agent.q);
      return { ...agent, ...result };
    }).sort((a, b) => b.reward - a.reward);

    if (!best || scored[0].reward > best.reward) best = scored[0];
    const clear = scored.find((agent) => agent.cleared);
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
  return {
    roomId,
    mode,
    clearAt,
    bestReward: best.reward,
    bestX: best.bestX,
    progress: best.bestX / (COLS - 1),
    used: [...best.used].join(","),
    startHeight,
    exitHeight,
    sameHeight: Math.abs(startHeight - exitHeight) <= 1,
  };
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

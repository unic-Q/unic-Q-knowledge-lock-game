"use strict";

import {
  COLS, ROWS, TILE, ROOM_FLOOR, EXIT_TOP_X, EXIT_BOTTOM_X, FLAG_W, FLAG_H,
} from "./constants.js";

export const roomLinks = {
  1: { r: 2, u: 12 },
  2: { l: 1, r: 3 },
  3: { l: 2, r: 4 },
  4: { l: 3, r: 5, u: 14 },
  5: { l: 4, r: 6 },
  6: { l: 5, r: 7 },
  7: { l: 6, r: 8, u: 16 },
  8: { l: 7, r: 9 },
  9: { l: 8, r: 10 },
  10: { l: 9, r: 11, u: 21 },
  11: { l: 10, r: 12 },
  12: { l: 11, d: 1, r: 13, u: 17 },
  13: { l: 12, r: 14 },
  14: { l: 13, r: 15, d: 4 },
  15: { l: 14, r: 16 },
  16: { l: 15, r: 17, d: 7, u: 21 },
  17: { l: 16, d: 12, r: 18 },
  18: { l: 17, r: 19, u: 23 },
  19: { l: 18, r: 20, u: 24 },
  20: { l: 19, r: 21 },
  21: { l: 20, d: 16 },
  22: { r: 23, u: 27 },
  23: { l: 22, r: 24, d: 18 },
  24: { l: 23, r: 25, d: 19 },
  25: { l: 24, r: 26, u: 30 },
  26: { l: 25 },
  27: { d: 22, r: 28, u: 32 },
  28: { l: 27, r: 29 },
  29: { l: 28, r: 30 },
  30: { l: 29, r: 31, d: 25 },
  31: { l: 30 },
  32: { d: 27, r: 33 },
  33: { l: 32, r: 34 },
  34: { l: 33, r: 35, d: 29 },
  35: { l: 34, r: 36 },
  36: { l: 35, u: 41 },
  37: { r: 38, u: 42 },
  38: { l: 37, r: 39, d: 33 },
  39: { l: 38, r: 40 },
  40: { l: 39, r: 41, d: 35 },
  41: { l: 40, d: 36, r: 47 },
  42: { d: 37, r: 43 },
  43: { l: 42, r: 44 },
  44: { l: 43, r: 45 },
  45: { l: 44, r: 46, d: 40 },
  46: { l: 45, d: 47 },
  47: { u: 46, l: 41, r: 48 },
  48: { l: 47, r: 49 },
  49: { l: 48, r: 50 },
  50: { l: 49 },
};

const sideExitRows = {
  1: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  2: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  3: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  4: [8, 9],
  5: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  6: [8, 9],
  7: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  8: [8, 9],
  9: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  10: [8, 9],
  11: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  12: [8, 9],
  13: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  14: [8, 9],
  15: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  16: [8, 9],
  17: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  18: [8, 9],
  19: [ROOM_FLOOR - 2, ROOM_FLOOR - 1],
  20: [8, 9],
};

const roomThemes = [
  "移动 / 跳跃 / 白色死区", "可选头盔", "双路线", "白色贴面", "白色死区",
  "白色钩锁", "红色四格脉冲", "红色QTE", "绿色墓碑残影", "黑色旋转侵蚀",
  "回头捷径", "无头盔高台", "白色天花板", "红色竖井", "绿线危险",
  "钩锁转角", "黑色落井", "二段跳密室", "墓碑回溯", "红白混合",
  "纵向回环", "隐藏砖", "瘟疫绕路", "战争破裂", "死亡暗道",
  "短支路", "饥荒箱庭", "平台节奏", "白绿选择", "红黑选择",
  "远端捷径", "天花板长廊", "红色连跳", "绿色桥", "黑色碎层",
  "回环门廊", "支路试炼", "四骑士前厅", "白色绳路", "红色爆破",
  "黑色回转", "上层入口", "瘟疫塔", "死亡线", "饥荒井",
  "上层回环", "终段一", "终段二", "终段三", "终段出口",
];

export const worldRooms = Array.from({ length: 50 }, (_, i) => makeRoomDef(i + 1));

function makeRoomDef(id) {
  const links = roomLinks[id] || {};
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill("."));
  for (let x = 0; x < COLS; x += 1) {
    grid[0][x] = "#";
    grid[ROWS - 1][x] = "#";
    grid[ROOM_FLOOR][x] = "#";
  }
  for (let y = 0; y < ROWS; y += 1) {
    grid[y][0] = "#";
    grid[y][COLS - 1] = "#";
  }

  if (links.l) carveLeftExit(grid, sideExitRows[id - 1]);
  if (links.r) carveRightExit(grid, sideExitRows[id]);
  if (links.u) carveTopExit(grid);
  if (links.d) carveBottomExit(grid);
  applyRoomPattern(grid, id);
  applyRouteLock(grid, id);

  return {
    id,
    name: `${String(id).padStart(2, "0")} / ${roomThemes[id - 1] || "连续地图"}`,
    spawn: id === 1 ? [68, ROOM_FLOOR * TILE - 28] : [70, ROOM_FLOOR * TILE - 28],
    flag: { x: TILE * 2 + 6, y: ROOM_FLOOR * TILE - FLAG_H, w: FLAG_W, h: FLAG_H },
    helmet: id === 2 ? { x: TILE * 13 + 4, y: ROOM_FLOOR * TILE - 28, w: 24, h: 24, taken: false } : null,
    links,
    blocks: grid.map((row) => row.join("")),
  };
}

function carveLeftExit(grid, rows = [ROOM_FLOOR - 2, ROOM_FLOOR - 1]) {
  for (const y of rows) grid[y][0] = ".";
}

function carveRightExit(grid, rows = [ROOM_FLOOR - 2, ROOM_FLOOR - 1]) {
  for (const y of rows) grid[y][COLS - 1] = ".";
}

function carveTopExit(grid) {
  for (let x = EXIT_TOP_X; x < EXIT_TOP_X + 3; x += 1) {
    grid[0][x] = ".";
    grid[1][x] = ".";
  }
  grid[2][EXIT_TOP_X + 1] = "=";
}

function carveBottomExit(grid) {
  for (let x = EXIT_BOTTOM_X; x < EXIT_BOTTOM_X + 3; x += 1) {
    grid[ROOM_FLOOR][x] = ".";
    grid[ROWS - 1][x] = ".";
  }
}

function put(grid, x, y, ch = "#") {
  if (x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1) grid[y][x] = ch;
}

function line(grid, x1, x2, y, ch = "#") {
  for (let x = x1; x <= x2; x += 1) put(grid, x, y, ch);
}

function pillar(grid, x, y1, y2, ch = "#") {
  for (let y = y1; y <= y2; y += 1) put(grid, x, y, ch);
}

function clearCells(grid, chars) {
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (chars.includes(grid[y][x])) grid[y][x] = ".";
    }
  }
}

function applyRouteLock(grid, id) {
  if (id < 3 || id > 20) return;
  clearCells(grid, "KD");
  if (id === 3) {
    line(grid, 1, 2, 5);
    put(grid, 1, 4, "K");
  } else if (id === 14) {
    put(grid, 23, 7, "K");
  } else if (id === 18) {
    put(grid, 21, 4, "K");
  } else if (id % 2 === 0) {
    line(grid, 3, 5, 7);
    put(grid, 5, 6, "K");
  } else {
    line(grid, 2, 4, 5);
    put(grid, 3, 4, "K");
  }
  pillar(grid, 26, 1, 9, "D");
}

function applyRoomPattern(grid, id) {
  if (id === 1) {
    line(grid, 5, 8, 8);
    line(grid, 12, 15, 7);
    line(grid, 19, 23, 6);
    line(grid, 25, 27, 8);
    return;
  }
  if (id === 2) return;
  if (id === 3) {
    line(grid, 1, 2, 6);
    put(grid, 1, 5, "K");
    line(grid, 3, 5, 8);
    pillar(grid, 6, 6, 9);
    line(grid, 8, 9, 8);
    line(grid, 10, 11, 6);
    put(grid, 12, 8, "R");
    line(grid, 14, 15, 8);
    line(grid, 16, 20, 8, "!");
    line(grid, 22, 25, 7);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 4) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 5, 7, 8);
    line(grid, 10, 12, 7);
    put(grid, 13, 7, "M");
    line(grid, 15, 17, 5);
    put(grid, 19, 6, "M");
    line(grid, 19, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    line(grid, 8, 10, 8, "!");
    line(grid, 14, 16, 8, "!");
    return;
  }
  if (id === 5) {
    line(grid, 2, 4, 5);
    put(grid, 2, 4, "K");
    line(grid, 5, 9, 8);
    put(grid, 12, 9, "M");
    put(grid, 16, 9, "M");
    put(grid, 20, 9, "M");
    put(grid, 23, 9, "M");
    line(grid, 21, 25, 8);
    line(grid, 10, 20, 6);
    line(grid, 10, 12, 8, "!");
    line(grid, 18, 20, 8, "!");
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 6) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 5, 8, 8);
    line(grid, 12, 15, 7);
    put(grid, 16, 6, "G");
    line(grid, 20, 25, 8);
    line(grid, 9, 11, 8, "!");
    line(grid, 17, 19, 5, "~");
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 7) {
    line(grid, 2, 4, 5);
    put(grid, 3, 4, "K");
    line(grid, 5, 8, 8);
    put(grid, 12, 9, "M");
    put(grid, 16, 9, "M");
    line(grid, 19, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    line(grid, 20, 22, 8, "~");
    line(grid, 10, 18, 6);
    return;
  }
  if (id === 8) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 4, 7, 8);
    line(grid, 10, 12, 6);
    line(grid, 15, 17, 8);
    line(grid, 20, 22, 6);
    put(grid, 13, 7, "M");
    put(grid, 18, 5, "M");
    line(grid, 8, 9, 8, "!");
    line(grid, 14, 15, 8, "~");
    line(grid, 23, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 9) {
    line(grid, 2, 4, 5);
    put(grid, 2, 4, "K");
    line(grid, 5, 8, 5);
    line(grid, 20, 25, 5);
    pillar(grid, 26, 1, 9, "D");
    line(grid, 10, 18, 8, "!");
    put(grid, 13, 8, "M");
    line(grid, 16, 18, 5, "~");
    return;
  }
  if (id === 10) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 5, 7, 8);
    line(grid, 10, 13, 7);
    put(grid, 14, 6, "W");
    line(grid, 18, 25, 8, "!");
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 11) {
    line(grid, 2, 4, 5);
    put(grid, 2, 4, "K");
    line(grid, 5, 8, 8);
    pillar(grid, 12, 5, 8);
    line(grid, 12, 18, 5);
    pillar(grid, 18, 5, 8);
    put(grid, 15, 6, "M");
    line(grid, 13, 17, 8, "!");
    line(grid, 21, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 12) {
    line(grid, 1, 2, 4);
    line(grid, 3, 4, 6);
    put(grid, 1, 3, "K");
    line(grid, 6, 10, 8);
    put(grid, 13, 9, "M");
    put(grid, 17, 9, "M");
    line(grid, 20, 25, 8);
    line(grid, 11, 19, 6, "!");
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 13) {
    line(grid, 2, 4, 5);
    put(grid, 3, 4, "K");
    line(grid, 5, 8, 8);
    line(grid, 11, 15, 6, "~");
    put(grid, 20, 9, "M");
    line(grid, 21, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 14) {
    line(grid, 5, 8, 8);
    line(grid, 11, 14, 7);
    put(grid, 15, 6, "B");
    line(grid, 16, 22, 7, "E");
    line(grid, 20, 25, 6, "E");
    line(grid, 24, 25, 7, "E");
    put(grid, 23, 7, ".");
    line(grid, 20, 25, 8);
    pillar(grid, 19, 6, 8, "E");
    line(grid, 9, 11, 8, "!");
    return;
  }
  if (id === 15) {
    line(grid, 1, 2, 4);
    line(grid, 3, 4, 6);
    put(grid, 1, 3, "K");
    line(grid, 5, 9, 8);
    line(grid, 11, 14, 9, "E");
    line(grid, 15, 18, 8);
    put(grid, 20, 9, "M");
    line(grid, 19, 21, 6, "~");
    line(grid, 21, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 16) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 5, 8, 8);
    line(grid, 11, 13, 8, "~");
    put(grid, 15, 9, "M");
    line(grid, 16, 18, 9, "E");
    line(grid, 22, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 17) {
    line(grid, 1, 2, 4);
    line(grid, 3, 4, 6);
    put(grid, 1, 3, "K");
    line(grid, 5, 8, 8);
    line(grid, 10, 14, 8, "E");
    line(grid, 15, 18, 7);
    put(grid, 20, 8, "M");
    line(grid, 15, 18, 5, "~");
    line(grid, 21, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 18) {
    line(grid, 3, 5, 8);
    line(grid, 5, 8, 8);
    line(grid, 11, 14, 6);
    line(grid, 16, 18, 8, "!");
    put(grid, 15, 5, "M");
    line(grid, 19, 23, 5, "E");
    line(grid, 19, 23, 7, "E");
    put(grid, 21, 5, ".");
    line(grid, 24, 26, 8);
    line(grid, 20, 22, 5, "~");
    return;
  }
  if (id === 19) {
    line(grid, 2, 4, 5);
    put(grid, 3, 4, "K");
    line(grid, 5, 8, 8);
    put(grid, 10, 9, "M");
    line(grid, 12, 15, 6, "~");
    line(grid, 16, 18, 9, "E");
    put(grid, 20, 9, "M");
    line(grid, 22, 24, 6, "!");
    line(grid, 22, 25, 8);
    pillar(grid, 26, 1, 9, "D");
    return;
  }
  if (id === 20) {
    line(grid, 3, 5, 8);
    put(grid, 5, 7, "K");
    line(grid, 5, 8, 8);
    line(grid, 11, 13, 8, "~");
    put(grid, 15, 9, "M");
    line(grid, 16, 18, 9, "E");
    line(grid, 22, 25, 8);
    line(grid, 24, 26, 5, "!");
    pillar(grid, 26, 1, 9, "D");
    return;
  }

  const variant = id % 8;
  if (variant === 0) {
    line(grid, 6, 10, 8);
    line(grid, 17, 22, 6);
    put(grid, 14, 5, "A");
  } else if (variant === 1) {
    line(grid, 5, 8, 7);
    line(grid, 12, 14, 5, "H");
    line(grid, 20, 24, 8);
  } else if (variant === 2) {
    line(grid, 9, 17, 8, "E");
    pillar(grid, 21, 5, 9);
  } else if (variant === 3) {
    line(grid, 7, 11, 8);
    line(grid, 14, 18, 6, "X");
    line(grid, 21, 24, 8);
  } else if (variant === 4) {
    pillar(grid, 8, 5, 9);
    line(grid, 8, 16, 5);
    put(grid, 18, 3, "A");
  } else if (variant === 5) {
    line(grid, 6, 9, 8);
    line(grid, 13, 16, 7);
    line(grid, 21, 26, 6);
  } else if (variant === 6) {
    line(grid, 10, 14, 8, "H");
    line(grid, 18, 22, 7);
  } else {
    line(grid, 6, 12, 8, "X");
    line(grid, 17, 24, 8, "E");
  }
}

export function parseRoom(data) {
  const blocks = [];
  const platforms = [];
  const cracks = [];
  const hidden = [];
  const anchors = [];
  const erode = [];
  const plagueHazards = [];
  const hazards = [];
  const enemies = [];
  const switches = [];
  const gates = [];
  const abilityPickups = [];
  data.blocks.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const b = { x: x * TILE, y: y * TILE, w: TILE, h: TILE, hp: 1, maxHp: 1, sink: 0, broken: false };
      if (cell === "#") blocks.push({ ...b, hp: 3, maxHp: 3 });
      if (cell === "=") platforms.push(b);
      if (cell === "X") cracks.push({ ...b, hp: 0.45, maxHp: 0.45 });
      if (cell === "H") hidden.push(b);
      if (cell === "E") erode.push({ ...b, hp: 0.75, maxHp: 0.75 });
      if (cell === "!") hazards.push({ ...b, type: "spike" });
      if (cell === "~") hazards.push({ ...b, type: "electric" });
      if (cell === "M") enemies.push({ x: b.x + 4, y: b.y + 7, w: TILE - 8, h: TILE - 7, alive: true });
      if (cell === "K") switches.push({ x: b.x + 4, y: b.y + TILE * 0.68, w: TILE - 8, h: TILE * 0.32, pressed: false });
      if (cell === "D") gates.push({ ...b, open: false });
      if ("GRWB".includes(cell)) abilityPickups.push({ x: b.x + 4, y: b.y + 4, w: 24, h: 24, form: { G: "green", R: "red", W: "white", B: "black" }[cell], taken: false });
      if (cell === "A") anchors.push({ x: b.x + TILE / 2, y: b.y + TILE / 2 });
      if (cell === "P") {
        plagueHazards.push({
          x: b.x + TILE / 2,
          y: b.y + TILE,
          nx: 0,
          ny: -1,
          tx: 1,
          ty: 0,
          len: TILE * 0.82,
          thick: 10,
          drip: (x + y) % 5,
          preset: true,
        });
      }
    });
  });
  return { ...data, blocks, platforms, cracks, hidden, anchors, erode, plagueHazards, hazards, enemies, switches, gates, abilityPickups };
}

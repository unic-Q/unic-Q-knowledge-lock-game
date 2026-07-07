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
  11: { l: 10 },
  12: { d: 1, r: 13, u: 17 },
  13: { l: 12, r: 14 },
  14: { l: 13, r: 15, d: 4 },
  15: { l: 14, r: 16 },
  16: { l: 15, d: 7, u: 21 },
  17: { d: 12, r: 18 },
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

const roomThemes = [
  "移动 / 跳跃 / 冲刺", "红色能力拾取", "红色冲刺路线", "白色贴面", "白色死区",
  "白色钩锁", "红色四格脉冲", "红色QTE", "绿色墓碑残影", "黑色旋转侵蚀",
  "回头捷径", "无头盔高台", "白色天花板", "红色竖井", "绿线危险",
  "钩锁转角", "黑色落井", "冲刺密室", "墓碑回溯", "红白混合",
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

  if (links.l) carveLeftExit(grid);
  if (links.r) carveRightExit(grid);
  if (links.u) carveTopExit(grid);
  if (links.d) carveBottomExit(grid);
  applyRoomPattern(grid, id);

  return {
    id,
    name: `${String(id).padStart(2, "0")} / ${roomThemes[id - 1] || "连续地图"}`,
    spawn: id === 1 ? [68, ROOM_FLOOR * TILE - 28] : [70, ROOM_FLOOR * TILE - 28],
    flag: { x: TILE * 2 + 6, y: ROOM_FLOOR * TILE - FLAG_H, w: FLAG_W, h: FLAG_H },
    helmet: id === 2 ? { x: TILE * 13 + 4, y: ROOM_FLOOR * TILE - 28, w: 24, h: 24, taken: false, form: "red" } : null,
    links,
    blocks: grid.map((row) => row.join("")),
  };
}

function carveLeftExit(grid) {
  for (let y = ROOM_FLOOR - 2; y <= ROOM_FLOOR - 1; y += 1) grid[y][0] = ".";
}

function carveRightExit(grid) {
  for (let y = ROOM_FLOOR - 2; y <= ROOM_FLOOR - 1; y += 1) grid[y][COLS - 1] = ".";
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

function applyRoomPattern(grid, id) {
  if (id === 1) {
    line(grid, 5, 8, 8);
    line(grid, 12, 15, 7);
    line(grid, 19, 23, 6);
    line(grid, 25, 27, 8);
    for (let x = 16; x <= 18; x += 1) put(grid, x, ROOM_FLOOR - 1, "P");
    return;
  }
  if (id === 2) return;
  if (id === 3) {
    line(grid, 6, 9, 8);
    line(grid, 16, 20, 8);
    line(grid, 23, 25, 7);
    pillar(grid, 13, 6, 9);
    return;
  }
  if (id === 4) {
    pillar(grid, 9, 4, 9);
    line(grid, 9, 18, 4);
    pillar(grid, 18, 4, 9);
    return;
  }
  if (id === 5) {
    line(grid, 7, 11, 8);
    line(grid, 16, 20, 7);
    for (let x = 12; x <= 15; x += 1) put(grid, x, ROOM_FLOOR - 1, "P");
    return;
  }
  if (id === 6) {
    line(grid, 6, 9, 8);
    put(grid, 13, 5, "A");
    line(grid, 19, 22, 6);
    put(grid, 24, 4, "A");
    return;
  }
  if (id === 7) {
    line(grid, 6, 8, 8);
    line(grid, 14, 16, 6);
    line(grid, 22, 24, 8);
    return;
  }
  if (id === 8) {
    line(grid, 5, 8, 8);
    line(grid, 12, 15, 6);
    line(grid, 19, 22, 5);
    return;
  }
  if (id === 9) {
    line(grid, 8, 11, 8);
    line(grid, 17, 20, 7, "H");
    line(grid, 23, 26, 6);
    return;
  }
  if (id === 10) {
    line(grid, 8, 21, 7, "E");
    line(grid, 12, 15, 5);
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
  data.blocks.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const b = { x: x * TILE, y: y * TILE, w: TILE, h: TILE, hp: 1, maxHp: 1, sink: 0, broken: false };
      if (cell === "#") blocks.push({ ...b, hp: 3, maxHp: 3 });
      if (cell === "=") platforms.push(b);
      if (cell === "X") cracks.push({ ...b, hp: 0.45, maxHp: 0.45 });
      if (cell === "H") hidden.push(b);
      if (cell === "E") erode.push({ ...b, hp: 0.75, maxHp: 0.75 });
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
  return { ...data, blocks, platforms, cracks, hidden, anchors, erode, plagueHazards };
}

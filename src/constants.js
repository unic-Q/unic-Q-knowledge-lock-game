"use strict";

export const TILE = 32;
export const COLS = 20;
export const ROWS = 20;
export const WIDTH = TILE * COLS;
export const HEIGHT = TILE * ROWS;
export const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
export const ROOM_FLOOR = 18;
export const EXIT_TOP_X = 8;
export const EXIT_BOTTOM_X = 8;
export const FLAG_W = 14;
export const FLAG_H = 28;

export const GRAVITY = TILE * 50;
export const MOVE = TILE * 7;
export const JUMP = Math.sqrt(2 * GRAVITY * TILE * 3.5);
export const GREEN_MOVE = 225;
export const GREEN_JUMP = 585;
export const GREEN_GRAVITY = 1900;
export const BLACK_JUMP = 533;
export const BLACK_GRAVITY = 1900;

export const ROLL_SPEED = 520;
export const ROLL_UP = 120;
export const ROLL_TIME = 0.34;
export const ROLL_COOLDOWN = 0.82;
export const ROLL_HAZARD_PAD = 0.1;

export const NONE_DASH_SPEED = 620;
export const NONE_DASH_TIME = 0.16;
export const NONE_DASH_COOLDOWN = 0.32;

export const RED_DASH_DISTANCE = TILE * 4;
export const RED_DASH_TIME = 0.22;
export const RED_QTE_TIME = 0.28;
export const RED_QTE_READY = 0.45;
export const RED_KILL_QTE_BONUS = 0.18;

export const WHITE_SURFACE_SPEED = TILE * 5;
export const WHITE_PLAGUE_SPEED = TILE * 8;
export const WHITE_SNAP = 24;
export const WHITE_HOOK_RANGE = TILE * 6;
export const WHITE_HOOK_EXTEND = TILE * 20;
export const WHITE_HOOK_PULL = 520;
export const WHITE_HOOK_HOLD = 0.5;
export const WHITE_HOOK_AIM_BIAS = 0.45;

export const ERODE_RATE = 1 / 6;
export const ERODE_FAST = 1;

export const FORMS = {
  none: { name: "无头盔", color: "#b8c7d8" },
  white: { name: "白 / 瘟疫", color: "#f4f2e6" },
  red: { name: "红 / 战争", color: "#e84d4d" },
  black: { name: "黑 / 饥荒", color: "#252632" },
  green: { name: "灰绿 / 死亡", color: "#7fa083" },
};

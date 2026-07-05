"use strict";

export const TILE = 32;
export const WIDTH = 960;
export const HEIGHT = 540;
export const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
export const COLS = 30;
export const ROWS = 12;
export const ROOM_FLOOR = 10;
export const EXIT_TOP_X = 5;
export const EXIT_BOTTOM_X = 5;
export const FLAG_W = 14;
export const FLAG_H = 28;

export const GRAVITY = 1900;
export const MOVE = 250;
export const JUMP = 650;

export const RED_DASH_DISTANCE = TILE * 4;
export const RED_DASH_TIME = 0.22;
export const RED_QTE_TIME = 0.28;
export const RED_QTE_READY = 0.45;

export const WHITE_SURFACE_SPEED = 185;
export const WHITE_SNAP = 24;
export const WHITE_HOOK_RANGE = TILE * 6;
export const WHITE_HOOK_PULL = 520;
export const WHITE_HOOK_HOLD = 0.5;
export const WHITE_HOOK_AIM_BIAS = 0.45;

export const ERODE_RATE = 0.22;
export const ERODE_FAST = 1.25;

export const FORMS = {
  none: { name: "无头盔", color: "#b8c7d8" },
  white: { name: "白 / 瘟疫", color: "#f4f2e6" },
  red: { name: "红 / 战争", color: "#e84d4d" },
  black: { name: "黑 / 饥荒", color: "#252632" },
  green: { name: "灰绿 / 死亡", color: "#7fa083" },
};

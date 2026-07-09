"use strict";

export function makePlayer(x, y) {
  return {
    x, y, w: 24, h: 28,
    vx: 0, vy: 0,
    facing: 1,
    onGround: false,
    jumps: 0,
    coyote: 0,
    dropTimer: 0,
    noneDash: null,
    noneDashCooldown: 0,
    wallSlide: 0,
    rollTimer: 0,
    rollCooldown: 0,
    rollRefreshQueued: false,
    redQte: null,
    redDash: null,
    redQteBonus: 0,
    redMisses: 0,
    stun: 0,
    graves: [],
    greenAfterimage: false,
    plague: [],
    plagueGrace: 0,
    hook: null,
    hookTime: 0,
    whiteSurface: null,
  };
}

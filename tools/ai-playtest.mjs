const actions = [
  "walk",
  "jump",
  "double_jump",
  "roll",
  "switch_press",
  "red_dash",
  "red_qte",
  "red_kill",
  "green_spirit",
  "green_grave",
  "white_attach",
  "white_hook",
  "white_plague",
  "black_erode",
  "black_rotate",
  "black_stomp",
  "combo",
];

const rooms = [
  [["jump"], ["red_dash", "roll"], ["red_qte"]],
  [["red_dash"], ["red_kill"], ["switch_press"], ["roll", "walk"]],
  [["red_qte"], ["red_kill"], ["red_dash"], ["double_jump"]],
  [["green_spirit", "roll"], ["green_grave"], ["switch_press"]],
  [["green_grave"], ["green_spirit"], ["walk"], ["jump"]],
  [["green_spirit"], ["red_dash"], ["green_grave"], ["switch_press"]],
  [["green_grave"], ["red_kill"], ["roll"], ["red_qte"]],
  [["white_attach", "roll"], ["white_hook"], ["white_plague"]],
  [["white_attach"], ["white_plague"], ["switch_press"], ["walk"]],
  [["white_hook"], ["white_plague"], ["red_dash"], ["green_spirit"]],
  [["black_rotate"], ["black_erode"], ["roll", "walk"]],
  [["black_rotate"], ["black_erode"], ["black_stomp"], ["red_dash"]],
  [["black_erode"], ["green_grave"], ["switch_press"], ["red_kill"]],
  [["white_attach"], ["white_hook"], ["black_erode"], ["green_spirit"]],
  [["green_grave"], ["black_rotate"], ["black_erode"], ["red_dash"]],
  [["white_plague"], ["red_qte"], ["green_spirit"], ["switch_press"], ["roll"]],
  [["black_rotate"], ["black_erode"], ["white_attach"], ["red_kill"], ["green_grave"]],
  [["green_spirit"], ["white_hook"], ["white_plague"], ["black_erode"], ["red_dash"]],
];

const q = Array.from({ length: rooms.length }, (_, roomIndex) => (
  Array.from({ length: rooms[roomIndex].length }, () => Object.fromEntries(actions.map((a) => [a, 0])))
));
let seed = 20260707;

function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function choose(roomIndex, phaseIndex, epsilon) {
  if (rand() < epsilon) return actions[Math.floor(rand() * actions.length)];
  const row = q[roomIndex][phaseIndex];
  let best = actions[0];
  for (const action of actions) {
    if (row[action] > row[best]) best = action;
  }
  return best;
}

function runEpisode(episode) {
  let room = 0;
  let phase = 0;
  const epsilon = Math.max(0.18, 0.92 - episode * 0.035);
  let steps = 0;
  while (room < rooms.length && steps < 140) {
    const action = choose(room, phase, epsilon);
    const ok = rooms[room][phase].includes(action);
    q[room][phase][action] += ok ? 1.2 : -0.3;
    if (ok) {
      phase += 1;
      if (phase >= rooms[room].length) {
        room += 1;
        phase = 0;
      }
    } else if (rand() < 0.28) {
      phase = 0;
    } else if (rand() < 0.1) {
      room = Math.max(0, room - 1);
      phase = 0;
    }
    steps += 1;
  }
  return room >= rooms.length;
}

let successAt = null;
for (let episode = 1; episode <= 20; episode += 1) {
  if (runEpisode(episode)) {
    successAt = episode;
    break;
  }
}

if (successAt !== null) {
  console.log(`FAIL: AI cleared the abstract 3-20 route within ${successAt} attempts. Redesign required.`);
  process.exitCode = 1;
} else {
  console.log("PASS: AI did not clear the abstract 3-20 route within 20 attempts.");
  console.log("This only checks strategy-discovery difficulty, not pixel-perfect platform execution.");
}

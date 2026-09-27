// Captures the README demo clip frame by frame (test sprites, a bot at the controls; test fixture only).
// The sim runs at its fixed 60 Hz step and every 4th tick is rendered, so the clip is 15 fps of game time
// regardless of how fast the headless browser is. Run: node games/daily-crypt/tests/run-demo.mjs
import { botInput, fakeRoster, fakeSprites } from "./sim";
import { Game, TICK, type Input } from "../engine/game";
import { render } from "../engine/render";
import type { FamilyId } from "../engine/themes";
declare global { interface Window { capture: (seed: number) => string[]; } }

const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 640; document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
const FAMILIES: FamilyId[] = [5, 1, 6, 7];

window.capture = (seed: number) => {
  const game = new Game(fakeSprites(7730, 5), 5, fakeRoster(FAMILIES), seed);
  game.halo = "#7fd8ff"; // a Frost halo, to show the cosmetic
  const input: Input = { keys: new Set(), move: null, aim: null };
  const frames: string[] = [];
  let god = true, ticks = 0;
  const step = () => {
    if (game.choice) { game.choose(0); return; }
    if (game.reviveOffer) { game.revive(); return; }
    if (god) game.player.invuln = 1;
    botInput(game, input);
    game.update(TICK, input); game.drainEvents(); ticks++;
  };
  // Fast-forward (invulnerable, not rendered) until `ready`, then record `seconds` of honest play.
  const segment = (ready: () => boolean, seconds: number) => {
    let guard = 0;
    while (game.status === "playing" && !ready() && guard++ < 60 * 400) step();
    god = false; game.player.invuln = 0;
    for (let i = 0; i < seconds * 60 && game.status === "playing"; i++) {
      step();
      if (i % 4 === 0) { render(ctx, game, ticks * TICK * 1000); frames.push(canvas.toDataURL("image/png")); }
    }
    god = true;
  };
  const crowded = (room: number) => () => game.roomIndex === room && game.state.enemies.length >= 8 && game.state.enemies.every(e => e.spawn <= 0) && game.tears.length > 3;
  segment(crowded(7), 5.5);
  segment(() => game.boss !== null && game.bossIntro <= 0 && game.boss.hp < game.boss.maxHp * 0.95, 6.5);
  return frames;
};

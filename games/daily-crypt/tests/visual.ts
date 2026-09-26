import { run } from "./sim";
import { render } from "../engine/render";
import type { FamilyId } from "../engine/themes";
declare global { interface Window { shots: string[]; } }
const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 640; document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
window.shots = [];
const fams: FamilyId[][] = [[0, 1, 2, 3], [4, 5, 6, 7]];
fams.forEach((floors, i) => {
  const taken = new Set<string>();
  run(3000 + i, floors[0], floors, true, (game, t) => {
    const snap = (label: string) => { if (taken.has(label)) return; taken.add(label); render(ctx, game, t * 1000); window.shots.push(label + "|" + canvas.toDataURL("image/png")); };
    const busy = game.state.enemies.length >= 6 && game.state.enemies.every(e => e.spawn <= 0) && game.tears.length > 4;
    if (busy && [0, 4, 8].includes(game.roomIndex)) snap(`run${i}-room${game.roomIndex + 1}`);
    if (game.boss && game.bossIntro <= 0 && game.tears.length > 10) snap(`run${i}-boss`);
    return taken.size >= 4;
  });
});

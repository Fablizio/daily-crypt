// Records a non-interactive gameplay clip with test sprites and a bot at the controls (test fixture only).
import { botInput, fakeRoster, fakeSprites } from "./sim";
import { Game, type Input } from "../engine/game";
import { render } from "../engine/render";
declare global { interface Window { done: Promise<string>; } }
const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 640; document.body.append(canvas);
const ctx = canvas.getContext("2d")!;
const game = new Game(fakeSprites(7730, 5), 5, fakeRoster([5, 1, 7, 6]), 4242);
const input: Input = { keys: new Set(), move: null, aim: null };
const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 3_000_000 });
const chunks: Blob[] = [];
recorder.ondataavailable = e => chunks.push(e.data);
window.done = new Promise(resolve => {
  recorder.onstop = async () => {
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    resolve(btoa(bin));
  };
});
recorder.start(1000);
let t = 0, last = performance.now();
const loop = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  if (game.player.hp <= 2) game.player.hp = game.stats.maxHp; // keep the demo going
  botInput(game, input);
  game.update(dt, input);
  game.drainEvents();
  render(ctx, game, now);
  if (t < 75 && game.status === "playing") requestAnimationFrame(loop); else recorder.stop();
};
requestAnimationFrame(loop);

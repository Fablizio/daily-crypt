/**
 * Input recording and replay verification. A run is stored as its per-tick inputs (4 signed bytes each:
 * move x/y and aim x/y, quantized to ±127) plus the index of the power-up chosen after room 5.
 * Replaying those inputs through a fresh Game with the same day seed, roster and Friend reproduces the run
 * exactly, so the claimed time can be recomputed rather than trusted.
 */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { Game, TICK, type Input, type Vec } from "./game";
import type { Roster } from "./roster";
import type { FamilyId } from "./themes";

export const MAX_TICKS = 60 * 60 * 15; // 15 minutes

const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));
export function quantize(move: Vec | null, aim: Vec | null): [number, number, number, number] {
  return [q(move?.x ?? 0), q(move?.y ?? 0), q(aim?.x ?? 0), q(aim?.y ?? 0)];
}
export function toInput(frame: ArrayLike<number>, offset = 0): Input {
  const mx = frame[offset] / 127, my = frame[offset + 1] / 127, ax = frame[offset + 2] / 127, ay = frame[offset + 3] / 127;
  return { keys: new Set(), move: mx || my ? { x: mx, y: my } : null, aim: ax || ay ? { x: ax, y: ay } : null };
}

export class Recorder {
  private buffer = new Int8Array(4 * 60 * 60);
  length = 0;
  choices: number[] = [];
  push(frame: [number, number, number, number]) {
    if ((this.length + 1) * 4 > this.buffer.length) { const next = new Int8Array(this.buffer.length * 2); next.set(this.buffer); this.buffer = next; }
    this.buffer.set(frame, this.length * 4); this.length++;
  }
  frames() { return this.buffer.slice(0, this.length * 4); }
}

export type RunResult = { status: "playing" | "dead" | "won"; ticks: number; hits: number; time: number };
export type RunRecord = { seed: number; friendId: bigint; family: FamilyId; frames: Int8Array; choices: number[]; claimed: RunResult };

export function result(game: Game): RunResult {
  return { status: game.status, ticks: game.ticks, hits: game.hits, time: game.finalTime };
}

/** Re-simulate a recorded run from scratch. Returns the recomputed result and whether it matches the claim. */
export function verify(record: RunRecord, playerSprites: GenerationSprites, roster: Roster) {
  const game = new Game(playerSprites, record.family, roster, record.seed);
  let frame = 0, choice = 0;
  const total = record.frames.length / 4;
  while (game.status === "playing" && frame < total && frame < MAX_TICKS) {
    if (game.choice) { if (!game.choose(record.choices[choice++] ?? -1)) break; continue; }
    game.update(TICK, toInput(record.frames, frame * 4));
    game.drainEvents();
    frame++;
  }
  const recomputed = result(game);
  const claimed = record.claimed;
  const ok = recomputed.status === claimed.status && recomputed.ticks === claimed.ticks && recomputed.hits === claimed.hits && frame === total;
  return { ok, recomputed, game };
}

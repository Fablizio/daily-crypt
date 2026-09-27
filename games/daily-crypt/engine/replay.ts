/**
 * Input recording and replay verification. A run is stored as its per-tick inputs (4 signed bytes each:
 * move x/y and aim x/y, quantized to ±127), the index of the power-up chosen after room 5, and the tick at
 * which each paid continue (revive) was accepted.
 * Replaying those inputs through a fresh Game with the same day seed, roster and Friend reproduces the run
 * exactly, so the claimed time can be recomputed rather than trusted.
 */
import type { GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { Game, MAX_REVIVES, TICK, type Input, type Vec } from "./game";
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
  /** game.ticks at each accepted continue, in order. A continue offer at any other tick counts as declined. */
  revives: number[] = [];
  push(frame: [number, number, number, number]) {
    if ((this.length + 1) * 4 > this.buffer.length) { const next = new Int8Array(this.buffer.length * 2); next.set(this.buffer); this.buffer = next; }
    this.buffer.set(frame, this.length * 4); this.length++;
  }
  frames() { return this.buffer.slice(0, this.length * 4); }
}

export type RunResult = { status: "playing" | "dead" | "won"; ticks: number; hits: number; time: number; revives: number };
export type RunRecord = { seed: number; friendId: bigint; family: FamilyId; frames: Int8Array; choices: number[]; revives: number[]; claimed: RunResult };

export function result(game: Game): RunResult {
  return { status: game.status, ticks: game.ticks, hits: game.hits, time: game.finalTime, revives: game.revives };
}

/**
 * Resolve whatever decision the game is waiting on (power-up choice or continue offer) from the record.
 * Shared by verify(), Watch replay and the ghost, so all three take exactly the same branches.
 * Returns false when the record cannot answer (an invalid choice): the replay stops there.
 */
export function applyDecision(game: Game, record: RunRecord, cursor: { choice: number; revive: number }) {
  if (game.choice) return game.choose(record.choices[cursor.choice++] ?? -1);
  if (game.reviveOffer) {
    if (record.revives[cursor.revive] === game.ticks) { cursor.revive++; return game.revive(); }
    return game.declineRevive();
  }
  return true;
}

/** Step a replaying game by one recorded tick, resolving decisions first. Returns false when the log is exhausted. */
export function stepRecorded(game: Game, record: RunRecord, cursor: { frame: number; choice: number; revive: number }) {
  while (game.status === "playing" && (game.choice || game.reviveOffer)) if (!applyDecision(game, record, cursor)) return false;
  if (game.status !== "playing" || cursor.frame * 4 >= record.frames.length) return false;
  game.update(TICK, toInput(record.frames, cursor.frame * 4));
  cursor.frame++;
  // A decision raised on the final recorded tick (e.g. the fatal hit, then "end run") is resolved here too.
  while (game.status === "playing" && (game.choice || game.reviveOffer) && cursor.frame * 4 >= record.frames.length) if (!applyDecision(game, record, cursor)) break;
  return true;
}

/** Re-simulate a recorded run from scratch. Returns the recomputed result and whether it matches the claim. */
export function verify(record: RunRecord, playerSprites: GenerationSprites, roster: Roster) {
  const game = new Game(playerSprites, record.family, roster, record.seed);
  const cursor = { frame: 0, choice: 0, revive: 0 };
  const total = record.frames.length / 4;
  const legal = record.revives.length <= MAX_REVIVES;
  while (legal && game.status === "playing" && cursor.frame < MAX_TICKS) {
    if (!stepRecorded(game, record, cursor)) break;
    game.drainEvents();
  }
  const recomputed = result(game);
  const claimed = record.claimed;
  // Every recorded continue must have been consumed at an actual offer, and no more than MAX_REVIVES.
  const ok = legal && recomputed.status === claimed.status && recomputed.ticks === claimed.ticks && recomputed.hits === claimed.hits
    && recomputed.revives === claimed.revives && cursor.revive === record.revives.length && cursor.frame === total;
  return { ok, recomputed, game };
}

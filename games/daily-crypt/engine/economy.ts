/**
 * Daily Crypt economy: SIMULATED. No real RF moves in this prototype.
 * Entry fees split into a burned share and the day's prize pool, which pays the top three at 00:00 UTC.
 * Rival entries are generated from the day's seed and are always labelled as simulated.
 */
import { createRng } from "./rng";
import { FAMILY_NAMES, type FamilyId } from "./themes";

export const ENTRY_RF = 10;
export const BURN_PCT = 20;
export const PRIZE_SPLIT = [50, 30, 20] as const;
export const START_BALANCE_RF = 100;

export const burnOf = (entries: number) => (entries * ENTRY_RF * BURN_PCT) / 100;
export const poolOf = (entries: number) => entries * ENTRY_RF - burnOf(entries);
export const payouts = (pool: number) => PRIZE_SPLIT.map(pct => (pool * pct) / 100);

/** UTC day key, e.g. "2026-09-27". The crypt changes at 00:00 UTC for everyone. */
export function dayKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
export function msToReset(now = Date.now()) {
  const next = new Date(now); next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}
/** FNV-1a over the day key: the only input to today's crypt. */
export function daySeed(day: string) {
  let h = 0x811c9dc5;
  for (const ch of `daily-crypt:${day}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export type Entry = { name: string; family: FamilyId; time: number; hits: number; you: boolean; simulated: boolean };

/** Seeded, clearly simulated competition so the pool and leaderboard have something to show. */
export function simulatedDay(day: string) {
  const rng = createRng(daySeed(day) ^ 0x1b873593);
  const entries = 48 + rng.int(70);
  const rivals: Entry[] = Array.from({ length: 10 }, (_, i) => {
    const hits = rng.int(4);
    const clear = 175 + i * 18 + rng.range(0, 22);
    return { name: `Sim rival ${String(i + 1).padStart(2, "0")}`, family: rng.int(9) as FamilyId, time: clear + hits * 5, hits, you: false, simulated: true };
  });
  return { entries, rivals: rivals.sort((a, b) => a.time - b.time) };
}

export const familyLabel = (family: FamilyId) => FAMILY_NAMES[family];
export const rf = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} RF`;

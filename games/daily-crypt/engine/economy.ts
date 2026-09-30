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
/** Paid continue: once per ranked attempt, 100% burned (none of it reaches the pool). */
export const REVIVE_RF = 5;
export const REVIVE_BURN_PCT = 100;

/** Cosmetic halos: one-time purchase, 100% burned, render-only (never read by the simulation). */
export type HaloId = "bone" | "ember" | "frost" | "venom" | "gold" | "legendary";
/** `maxGen`: free and unlocked only for Friends of that generation or rarer (prestige, never sold). */
export type Halo = Readonly<{ id: HaloId; name: string; color: string; price: number; maxGen?: number }>;
export const HALOS: readonly Halo[] = [
  { id: "bone", name: "Bone", color: "#ffffff", price: 0 },
  { id: "ember", name: "Ember", color: "#ff7a3d", price: 20 },
  { id: "frost", name: "Frost", color: "#7fd8ff", price: 20 },
  { id: "venom", name: "Venom", color: "#b56bff", price: 40 },
  { id: "gold", name: "Gold", color: "#ffd23f", price: 80 },
  { id: "legendary", name: "Legendary", color: "#fff1a8", price: 0, maxGen: 2 },
];
/** A gated halo is unlocked by the Friend's generation alone; an unknown generation keeps it locked. */
export const haloUnlocked = (halo: Halo, generation: number | null) =>
  halo.maxGen === undefined || (generation !== null && generation >= 1 && generation <= halo.maxGen);

/**
 * Generation is PRESTIGE ONLY: a badge, the share line and a free Legendary halo for Gen 1-2. It is never
 * passed to the simulation, so it cannot change a run and ranked play stays fair.
 */
const TIERS = ["Legendary", "Epic", "Rare", "Uncommon", "Common"] as const;
export const generationTier = (generation: number) => TIERS[generation - 1] ?? "Standard";
/** "GEN 1 · LEGENDARY"; null when the generation is unknown or not hardwired (0). */
export const generationBadge = (generation: number | null | undefined) =>
  generation && generation >= 1 ? `GEN ${generation} · ${generationTier(generation).toUpperCase()}` : null;

/**
 * Projection assumptions (stated in the lobby and ECONOMY.md, not measured): a quarter of ranked attempts buy
 * the continue, and one halo is sold per 100 attempts at the average paid-halo price.
 */
export const REVIVE_TAKE_RATE = 0.25;
export const HALO_PER_ATTEMPT = 0.01;
export const HALO_AVG_RF = HALOS.filter(h => h.price > 0).reduce((sum, h) => sum + h.price, 0) / HALOS.filter(h => h.price > 0).length;
export function projection(attemptsPerDay: number) {
  const entries = attemptsPerDay * ENTRY_RF * BURN_PCT / 100;
  const revives = attemptsPerDay * REVIVE_TAKE_RATE * REVIVE_RF * REVIVE_BURN_PCT / 100;
  const halos = attemptsPerDay * HALO_PER_ATTEMPT * HALO_AVG_RF;
  const day = entries + revives + halos;
  return { entries, revives, halos, day, month: day * 30 };
}

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

export type Entry = { name: string; family: FamilyId; time: number; hits: number; you: boolean; simulated: boolean; generation?: number | null };

/** Seeded, clearly simulated competition so the pool and leaderboard have something to show. */
export function simulatedDay(day: string) {
  const rng = createRng(daySeed(day) ^ 0x1b873593);
  const entries = 48 + rng.int(70);
  const rivals: Entry[] = Array.from({ length: 10 }, (_, i) => {
    const hits = rng.int(4);
    const clear = 175 + i * 18 + rng.range(0, 22);
    return { name: `Sim rival ${String(i + 1).padStart(2, "0")}`, family: rng.int(9) as FamilyId, time: clear + hits * 5, hits, you: false, simulated: true };
  });
  // Simulated rivals also buy continues (drawn after the rivals so their times are unchanged).
  const revives = Math.round(entries * (0.15 + rng.range(0, 0.15)));
  // Display-only generations for the rivals, drawn last so nothing above changes. Rarer generations are rarer.
  for (const rival of rivals) {
    const roll = rng.int(100);
    rival.generation = roll < 2 ? 1 : roll < 7 ? 2 : roll < 17 ? 3 : roll < 35 ? 4 : roll < 60 ? 5 : 6;
  }
  return { entries, revives, rivals: rivals.sort((a, b) => a.time - b.time) };
}

export const familyLabel = (family: FamilyId) => FAMILY_NAMES[family];
export const rf = (value: number) => `${Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1)} RF`;

/** Small seeded PRNG (mulberry32). Presentation and level generation only: no paid outcome uses it. */
export type Rng = {
  next(): number;
  int(max: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(items: T[]): T[];
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: max => Math.floor(next() * max),
    range: (min, max) => min + next() * (max - min),
    pick: items => items[Math.floor(next() * items.length)],
    chance: p => next() < p,
    shuffle: items => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
  };
  return rng;
}

export function randomSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  // Mix in time so the test fixture's fixed getRandomValues still varies between runs.
  return (value[0] ^ Math.floor(performance.now() * 1000) ^ Date.now()) >>> 0;
}

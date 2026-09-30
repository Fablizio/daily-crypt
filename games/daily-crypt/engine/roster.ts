/**
 * Picks the dungeon's inhabitants: real Rare Friends token IDs, with their canonical artwork read from the
 * SDK's pinned sprite registry on Robinhood mainnet.
 *
 * Only the public artwork registry is read (familyOf / seedOf / frames), plus one `generation` read of the
 * player's own Friend for its prestige badge. The Generations collection is never scanned, no owners are looked
 * up and no wallet is involved. Ownership of the *player's* Friend is verified
 * by the SDK runtime before this component mounts.
 */
import { createPublicClient, http, type Address } from "viem";
import {
  FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST as M, decodeGenerationSprites, type GenerationSprites,
} from "@rarefriends/friendsdk/sprites";
import { GENERATION_ELIGIBILITY_ABI } from "@rarefriends/friendsdk/identity";
import type { Rng } from "./rng";
import type { FamilyId } from "./themes";

/**
 * The daily cast is sampled from IDs 1-100,000. This is a sampling range, not the hardwired range: hardwired
 * Friends also exist above it (e.g. #332833 is a Gen 6).
 */
export const MAX_FRIEND_ID = 100_000;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const SAMPLE = 120;

export type FloorCast = Readonly<{ family: FamilyId; regulars: readonly GenerationSprites[]; boss: GenerationSprites }>;
export type Roster = Readonly<{ floors: readonly FloorCast[]; sampled: number }>;

let client: ReturnType<typeof makeClient> | null = null;
function makeClient() {
  return createPublicClient({ transport: http(M.rpcUrl, { retryCount: 1, timeout: 15_000, batch: { batchSize: 30, wait: 16 } }) });
}
const rpc = () => (client ??= makeClient());

type Call = { functionName: "familyOf" | "seedOf" | "frames"; args: readonly unknown[] };

const one = <T>(call: Call) => rpc().readContract({ address: M.registry, abi: FAMILIES_REGISTRY_ABI, ...call } as never)
  .then(value => value as T);

/** A single read, retried: artwork reads are cheap for the RPC but heavy to execute, so they can time out. */
async function readOne<T>(call: Call, attempts = 3): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try { return await one<T>(call); } catch { await new Promise(resolve => setTimeout(resolve, 250 * (i + 1))); }
  }
  return null;
}

/**
 * Cheap pure reads (familyOf, seedOf) go through Multicall3 in chunks. Heavy reads (frames: 64 bitmaps
 * rendered on chain) go one eth_call each, so no single call can exceed the node's gas cap. Any item that
 * fails is retried on its own before it counts as missing.
 */
async function readMany<T>(calls: readonly Call[], chunk = 60): Promise<(T | null)[]> {
  const out: (T | null)[] = new Array(calls.length).fill(null);
  const heavy = calls.some(call => call.functionName === "frames");
  if (!heavy) {
    for (let start = 0; start < calls.length; start += chunk) {
      const part = calls.slice(start, start + chunk);
      const contracts = part.map(call => ({ address: M.registry, abi: FAMILIES_REGISTRY_ABI, ...call })) as never[];
      try {
        const results = await rpc().multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
        results.forEach((result, i) => { if (result.status === "success") out[start + i] = result.result as T; });
      } catch { /* fall through to single reads */ }
    }
  }
  // Six at a time keeps a phone's connection and the public RPC comfortable.
  const missing = calls.map((_, i) => i).filter(i => out[i] === null);
  for (let start = 0; start < missing.length; start += 6) {
    await Promise.all(missing.slice(start, start + 6).map(async i => { out[i] = await readOne<T>(calls[i]); }));
  }
  return out;
}

async function assertChain() {
  if (await rpc().getChainId() !== M.chainId) throw new Error(`Artwork requires chain ${M.chainId}.`);
}

/**
 * The Daily Crypt cast depends only on the UTC day: every player meets the same Friends in the same rooms.
 * Four groups: rooms 1-3, rooms 4-5, rooms 6-7 and the final stretch with the boss.
 */
export const loadDailyRoster = (rng: Rng) => loadRoster(rng, null, null, 4);

/**
 * Four floors: the first belongs to the player's own family (home turf), the next three to other families.
 * Each floor gets up to five regular Friends and one boss Friend.
 */
export async function loadRoster(rng: Rng, playerId: bigint | null, playerFamily: FamilyId | null, floorCount = 4): Promise<Roster> {
  await assertChain();
  const ids = new Set<bigint>();
  while (ids.size < SAMPLE) {
    const id = BigInt(1 + rng.int(MAX_FRIEND_ID));
    if (id !== playerId) ids.add(id);
  }
  const sample = [...ids];
  const families = await readMany<number>(sample.map(id => ({ functionName: "familyOf", args: [id] })));
  const byFamily = new Map<FamilyId, bigint[]>();
  sample.forEach((id, index) => {
    const family = families[index];
    if (family === null || family < 0 || family > 8) return;
    const list = byFamily.get(family as FamilyId) ?? [];
    list.push(id); byFamily.set(family as FamilyId, list);
  });
  if (byFamily.size < 2) throw new Error("Could not read enough Friends from the artwork registry.");

  // Floor 1 is home turf; if the sample missed the player's family, start with the biggest group instead.
  const plan: FamilyId[] = [];
  if (playerFamily !== null && (byFamily.get(playerFamily)?.length ?? 0) >= 2) plan.push(playerFamily);
  const others = rng.shuffle([...byFamily.keys()].filter(family => !plan.includes(family) && byFamily.get(family)!.length >= 2));
  while (plan.length < floorCount && others.length) plan.push(others.shift()!);
  while (plan.length < floorCount) plan.push(rng.pick(plan));

  // Two reserves per group stand in for any Friend whose artwork can't be read.
  const chosen = plan.map(family => rng.shuffle([...byFamily.get(family)!]).slice(0, 8));
  const flat = [...new Set(chosen.flat())];
  const seeds = await readMany<number>(flat.map(id => ({ functionName: "seedOf", args: [id] })));
  const familyOf = new Map(sample.map((id, index) => [id, families[index]]));
  const ready = flat.map((id, index) => ({ id, family: familyOf.get(id)!, seed: seeds[index] })).filter(item => item.seed !== null);
  const frames = await readMany<readonly bigint[]>(ready.map(item => ({ functionName: "frames", args: [item.family, item.seed] })));
  const sprites = new Map<bigint, GenerationSprites>();
  ready.forEach((item, index) => {
    const bitmaps = frames[index];
    if (!bitmaps || bitmaps.length !== 64) return;
    try { sprites.set(item.id, decodeGenerationSprites(item.id, item.family!, item.seed!, bitmaps)); } catch { /* skip malformed */ }
  });

  const floors = plan.map((family, floor) => {
    const cast = chosen[floor].map(id => sprites.get(id)).filter((value): value is GenerationSprites => Boolean(value)).slice(0, 6);
    if (cast.length < 2) throw new Error("Some Friends' artwork could not be read. Retry to summon a new cast.");
    const boss = cast[cast.length - 1];
    return { family, boss, regulars: cast.slice(0, -1) };
  });
  return { floors, sampled: sample.length };
}

/**
 * The player's own Friend's generation (1 = rarest), read once from the Generations contract. Prestige only:
 * it feeds the badge, the share line and the Legendary halo, never the simulation. Any failure or odd value
 * returns null (no badge), and play is never blocked by it.
 */
export async function readGeneration(tokenId: bigint, timeoutMs = 8000): Promise<number | null> {
  try {
    const read = rpc().readContract({ address: M.generations, abi: GENERATION_ELIGIBILITY_ABI, functionName: "generation", args: [tokenId] });
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
    const value = await Promise.race([read, timeout]);
    if (value === null) return null;
    const generation = Number(value);
    return Number.isInteger(generation) && generation >= 1 && generation <= 255 ? generation : null;
  } catch { return null; }
}

/**
 * Picks the dungeon's inhabitants: real Rare Friends token IDs, with their canonical artwork read from the
 * SDK's pinned sprite registry on Robinhood mainnet.
 *
 * Only the public artwork registry is read (familyOf / seedOf / frames). The Generations collection is never
 * scanned, no owners are looked up and no wallet is involved. Ownership of the *player's* Friend is verified
 * by the SDK runtime before this component mounts.
 */
import { createPublicClient, http, type Address } from "viem";
import {
  FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST as M, decodeGenerationSprites, type GenerationSprites,
} from "@rarefriends/friendsdk/sprites";
import type { Rng } from "./rng";
import type { FamilyId } from "./themes";

/** Hardwired Generations Friends live in this ID range (higher IDs are Generation 0). */
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

/** One multicall when available; otherwise individual (JSON-RPC batched) reads. Failed items become null. */
async function readMany<T>(calls: readonly Call[]): Promise<(T | null)[]> {
  const contracts = calls.map(call => ({ address: M.registry, abi: FAMILIES_REGISTRY_ABI, ...call })) as never[];
  try {
    const results = await rpc().multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
    return results.map(result => (result.status === "success" ? result.result as T : null));
  } catch {
    return Promise.all(calls.map(call => rpc().readContract({
      address: M.registry, abi: FAMILIES_REGISTRY_ABI, ...call,
    } as never).then(value => value as T, () => null)));
  }
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

  const chosen = plan.map(family => rng.shuffle([...byFamily.get(family)!]).slice(0, 6));
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
    const cast = chosen[floor].map(id => sprites.get(id)).filter((value): value is GenerationSprites => Boolean(value));
    if (cast.length < 2) throw new Error("Some Friends' artwork could not be read. Retry to summon a new cast.");
    const boss = cast[cast.length - 1];
    return { family, boss, regulars: cast.slice(0, -1) };
  });
  return { floors, sampled: sample.length };
}

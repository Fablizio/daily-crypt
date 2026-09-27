/**
 * Daily Crypt simulation: ten rooms in a row, the player's Friend, enemy Friends and shots.
 * Deterministic: given the day's seed, roster and the per-tick inputs, a run always plays out the same way,
 * so a finished run can be verified by replaying its inputs (see replay.ts).
 */
import type { GenerationSprites, SpriteFacing } from "@rarefriends/friendsdk/sprites";
import { COLS, ROWS, OPPOSITE, STEP, DAILY_ROOMS, generateLinear, key, type Dir, type Floor, type Room } from "./dungeon";
import { createRng, type Rng } from "./rng";
import type { Roster } from "./roster";
import { BOSS_ATTACKS, PERKS, RELICS, THEMES, type BossAttack, type FamilyId, type RelicId } from "./themes";
import type { Sfx } from "./audio";

export const VIEW_W = 960, VIEW_H = 640;
export const TILE = 56, IN_X = 116, IN_Y = 102, IN_W = COLS * TILE, IN_H = ROWS * TILE, WALL = 40;
export const CX = IN_X + IN_W / 2, CY = IN_Y + IN_H / 2;
export const DOOR_POS: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [CX, IN_Y], down: [CX, IN_Y + IN_H], left: [IN_X, CY], right: [IN_X + IN_W, CY],
};

export type Vec = { x: number; y: number };
export type Tear = {
  x: number; y: number; vx: number; vy: number; life: number; age: number; r: number; dmg: number;
  friendly: boolean; pierce: boolean; split: boolean; homing: boolean; wobble: number; hit: Set<number>;
  /** Shots fired from above a rock (a flying shooter) ignore rocks until they reach open floor. */
  airborne?: boolean;
};
export type EnemyKind = "rattler" | "mimic" | "kin" | "cell" | "glitch" | "drifter" | "brute" | "glint" | "shade" | "boss";
const KIND_BY_FAMILY: readonly EnemyKind[] = ["rattler", "mimic", "kin", "cell", "glitch", "drifter", "brute", "glint", "shade"];
const BASE_HP: Readonly<Record<EnemyKind, number>> = { rattler: 10, mimic: 8, kin: 5, cell: 12, glitch: 8, drifter: 7, brute: 20, glint: 10, shade: 8, boss: 110 };

export type Enemy = {
  uid: number; kind: EnemyKind; family: FamilyId; sprites: GenerationSprites;
  x: number; y: number; vx: number; vy: number; r: number; hp: number; maxHp: number; speed: number; scale: number;
  flying: boolean; boss: boolean; elite: boolean; child: boolean; minion: boolean;
  state: string; t: number; t2: number; shots: number; alpha: number; flash: number; spawn: number;
  attack: number; lift: number; dir: Vec;
  facing: SpriteFacing; side: "left" | "right"; moving: boolean;
};
export type PickupKind = "heart" | "half" | "spark";
export type Pickup = { x: number; y: number; kind: PickupKind; t: number };
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
export type FloatText = { x: number; y: number; text: string; life: number; color: string };
export type Pedestal = { x: number; y: number; relic: RelicId | "heart"; taken: boolean };
export type Familiar = { x: number; y: number; cooldown: number };
export type Defeated = { id: bigint; family: FamilyId; sprites: GenerationSprites; boss: boolean };

export type PlayerStats = {
  maxHp: number; damage: number; fireDelay: number; shotSpeed: number; range: number; speed: number; tearR: number;
  pierce: boolean; twin: boolean; split: boolean; wobble: boolean; flying: boolean; burst: boolean; homing: boolean;
  invuln: number; familiars: number;
};

export type Input = {
  keys: Set<string>;
  move: Vec | null;      // touch stick, -1..1
  aim: Vec | null;       // touch stick or mouse direction (unit)
};

export type GameEvent =
  | { type: "sfx"; sfx: Sfx }
  | { type: "dead" } | { type: "won" }
  | { type: "toast"; title: string; text: string }
  | { type: "boss"; enemy: Enemy }
  | { type: "room"; index: number }
  | { type: "choice"; options: readonly RelicId[] }
  | { type: "hit"; hits: number }
  | { type: "revive-offer" } | { type: "revived" };

/** Fixed simulation step. The UI accumulates real time and steps the sim in whole ticks. */
export const TICK = 1 / 60;
export const HIT_PENALTY = 5;
export const BASE_GUARD = 6;
/** Paid continue: at most one per attempt, restoring this much guard. */
export const MAX_REVIVES = 1;
export const REVIVE_GUARD = 2;
/** Room plan: which cast group each room draws from, how many Friends and how dangerous. */
const ROOM_PLAN: readonly { group: number; mix?: number; count: number; difficulty: number; elite: number; elites?: number }[] = [
  { group: 0, count: 6, difficulty: 0, elite: 0 },
  { group: 0, count: 7, difficulty: 0.3, elite: 0 },
  { group: 0, count: 8, difficulty: 0.6, elite: 0.05 },
  { group: 1, count: 9, difficulty: 0.9, elite: 0.08 },
  { group: 1, count: 11, difficulty: 1.2, elite: 0, elites: 2 },
  { group: 2, count: 11, difficulty: 1.5, elite: 0.2 },
  { group: 2, mix: 1, count: 12, difficulty: 1.8, elite: 0.22 },
  { group: 3, mix: 2, count: 13, difficulty: 2.1, elite: 0.25 },
  { group: 3, mix: 0, count: 14, difficulty: 2.4, elite: 0.28 },
  { group: 3, count: 0, difficulty: 2.6, elite: 0 },
];
const EXTRA_ATTACK: Readonly<Record<FamilyId, BossAttack>> = { 0: "ring", 1: "spiral", 2: "spread", 3: "blink", 4: "ring", 5: "spread", 6: "ring", 7: "blink", 8: "spiral" };
type Spawn = { sprites: GenerationSprites; x: number; y: number; elite: boolean };

type RoomState = { enemies: Enemy[]; pickups: Pickup[]; pedestal: Pedestal | null; trapdoor: boolean };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

export class Game {
  readonly rng: Rng;
  readonly player = {
    x: CX, y: CY, r: 15, hp: 6, invuln: 0, cooldown: 0, shots: 0,
    facing: "down" as SpriteFacing, side: "right" as "left" | "right", moving: false, aimDir: { x: 0, y: 1 } as Vec,
  };
  stats: PlayerStats;
  relics: RelicId[] = [];
  familiars: Familiar[] = [];
  trail: Vec[] = [];
  depth = 0;
  floor!: Floor;
  room!: Room;
  roomStates = new Map<Room, RoomState>();
  tears: Tear[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  sparks = 0;
  /** Hits taken; each adds HIT_PENALTY seconds and the guard-th hit ends the run. */
  hits = 0;
  guard = BASE_GUARD;
  ticks = 0;
  roomIndex = 0;
  difficulty = 0;
  choice: readonly RelicId[] | null = null;
  /**
   * Set when the last guard breaks and a continue is still available. The sim stops (no ticks, clock paused)
   * until revive() or declineRevive() is called. Both are recorded in the run, so replays take the same branch.
   */
  reviveOffer = false;
  revivesLeft = MAX_REVIVES;
  revives = 0;
  readonly choiceOptions: readonly RelicId[];
  private plans: Spawn[][] = [];
  /** Cosmetic randomness (particles) never touches the simulation's RNG. */
  private fx: Rng;
  kills = 0;
  defeated: Defeated[] = [];
  status: "playing" | "dead" | "won" = "playing";
  time = 0;
  fade = 0;             // 0..1 black overlay during room change
  pendingRoom: { room: Room; from: Dir } | null = null;
  shake = 0;
  bossIntro = 0;
  reducedMotion = false;
  /** Outline colour of the player's Friend (cosmetic halo). Render only: never read by the simulation. */
  halo = "#ffffff";
  /** Practice runs use the same crypt but are never ranked. Display only. */
  practice = false;
  touch = false;
  events: GameEvent[] = [];
  private uid = 1;
  private flow: number[][] = [];
  private flowKey = "";

  constructor(readonly playerSprites: GenerationSprites, readonly playerFamily: FamilyId, readonly roster: Roster, seed: number) {
    this.rng = createRng(seed);
    this.fx = createRng(seed ^ 0x5bd1e995);
    this.stats = {
      maxHp: 6, damage: 3.5, fireDelay: 0.36, shotSpeed: 430, range: 0.72, speed: 215, tearR: 7,
      pierce: false, twin: false, split: false, wobble: false, flying: false, burst: false, homing: false, invuln: 1, familiars: 0,
    };
    const s = this.stats;
    switch (playerFamily) {
      case 0: s.pierce = true; break;
      case 1: s.twin = true; s.damage = 2.8; break;
      case 2: s.familiars = 1; break;
      case 3: s.split = true; break;
      case 4: s.wobble = true; s.damage *= 1.25; break;
      case 5: s.flying = true; break;
      case 6: s.maxHp = 8; s.tearR = 11; s.damage = 4.6; s.speed = 185; s.fireDelay = 0.44; break;
      case 7: s.burst = true; break;
      case 8: s.invuln = 1.8; s.speed = 240; break;
    }
    if (playerFamily === 6) this.guard = BASE_GUARD + 1;
    this.player.hp = this.guard;
    this.syncFamiliars();
    // Everything the crypt looks like is drawn from a layout RNG seeded by the day, before play starts,
    // so every player meets the same rooms, Friends, spawn points and power-up offer.
    const layout = createRng(seed ^ 0x2545f491);
    this.floor = generateLinear(layout);
    this.roomStates = new Map();
    for (const room of this.floor.rooms.values()) this.roomStates.set(room, { enemies: [], pickups: [], pedestal: null, trapdoor: false });
    const entry = { x: IN_X + 44, y: CY };
    for (let i = 0; i < DAILY_ROOMS; i++) {
      const plan = ROOM_PLAN[i], room = this.floor.rooms.get(key(i, 0))!;
      const pool = [...roster.floors[plan.group].regulars, ...(plan.mix !== undefined ? roster.floors[plan.mix].regulars : [])];
      const tiles: Vec[] = [];
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        if (room.tiles[y][x] !== 0) continue;
        const point = { x: IN_X + x * TILE + TILE / 2, y: IN_Y + y * TILE + TILE / 2 };
        if (dist(point, entry) >= 230) tiles.push(point);
      }
      layout.shuffle(tiles);
      const spawns: Spawn[] = [];
      let budget = plan.count, forced = plan.elites ?? 0;
      while (budget > 0 && tiles.length) {
        const sprites = layout.pick(pool), at = tiles.pop()!;
        const elite = forced > 0 ? (forced--, true) : layout.chance(plan.elite);
        if (sprites.familyId === 2) {
          for (let k = 0; k < 3; k++) spawns.push({ sprites, x: at.x + (k - 1) * 22, y: at.y + (k % 2) * 14, elite: false });
          budget -= 3;
        } else { spawns.push({ sprites, x: at.x, y: at.y, elite }); budget--; }
      }
      this.plans.push(spawns);
    }
    const pool = RELICS.filter(relic => relic.id !== "marrow"
      && !(relic.id === "boots" && s.flying) && !(relic.id === "petri" && s.split) && !(relic.id === "photo" && s.familiars >= 2));
    // The offer is the same for everyone today, but must suit this Friend's perk: pick from a fixed day order.
    const order = layout.shuffle([...RELICS.map(relic => relic.id)]);
    this.choiceOptions = order.filter(id => pool.some(relic => relic.id === id)).slice(0, 3);
    this.player.x = entry.x; this.player.y = entry.y; this.player.facing = "right";
    this.enterRoom(this.floor.start, null);
  }

  /** Clock shown to players: real play time plus hit penalties. */
  get elapsed() { return this.ticks * TICK; }
  get finalTime() { return this.elapsed + this.hits * HIT_PENALTY; }

  get theme() { return THEMES[this.cast.family]; }
  get cast() { return this.roster.floors[ROOM_PLAN[this.roomIndex].group]; }
  get floors() { return DAILY_ROOMS; }
  get perk() { return PERKS[this.playerFamily]; }
  get state() { return this.roomStates.get(this.room)!; }
  get boss() { return this.state.enemies.find(enemy => enemy.boss) ?? null; }

  private emit(event: GameEvent) { this.events.push(event); }
  private sfx(sfx: Sfx) { this.emit({ type: "sfx", sfx }); }

  private syncFamiliars() {
    while (this.familiars.length < this.stats.familiars) this.familiars.push({ x: this.player.x, y: this.player.y, cooldown: 0.3 });
  }

  // ─── Floors and rooms ──────────────────────────────────────────────────────

  private rollRelic(): RelicId | "heart" {
    const taken = new Set(this.relics);
    for (const state of this.roomStates?.values() ?? []) if (state.pedestal && typeof state.pedestal.relic === "string") taken.add(state.pedestal.relic as RelicId);
    const pool = RELICS.filter(relic => !taken.has(relic.id)
      && !(relic.id === "boots" && this.stats.flying) && !(relic.id === "petri" && this.stats.split)
      && !(relic.id === "photo" && this.stats.familiars >= 2));
    return pool.length ? this.rng.pick(pool).id : "heart";
  }

  private enterRoom(room: Room, from: Dir | null) {
    this.room = room;
    this.roomIndex = room.gx;
    this.difficulty = ROOM_PLAN[room.gx].difficulty;
    this.emit({ type: "room", index: room.gx });
    room.visited = true; room.seen = true;
    for (const d of Object.keys(room.doors) as Dir[]) {
      const next = this.floor.rooms.get(key(room.gx + STEP[d][0], room.gy + STEP[d][1]));
      if (next) next.seen = true;
    }
    this.tears = [];
    if (from) {
      // Arrive just inside the door on the side we came through.
      const [dx, dy] = DOOR_POS[from];
      const inward = STEP[OPPOSITE[from]];
      this.player.x = dx + inward[0] * 44; this.player.y = dy + inward[1] * 44;
      this.trail = [];
      for (const familiar of this.familiars) { familiar.x = this.player.x; familiar.y = this.player.y; }
    }
    const state = this.state;
    if (!room.cleared && state.enemies.length === 0) this.populate(room, from);
  }

  private freeTiles(minDistance: number, flying = false) {
    const out: Vec[] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const tile = this.room.tiles[y][x];
      if (tile === 1 || (tile === 2 && !flying)) continue;
      const point = { x: IN_X + x * TILE + TILE / 2, y: IN_Y + y * TILE + TILE / 2 };
      if (dist(point, this.player) >= minDistance) out.push(point);
    }
    return out;
  }

  private populate(room: Room, _from: Dir | null) {
    const state = this.state;
    if (room.kind === "boss") {
      const boss = this.makeEnemy(this.cast.boss, CX, IN_Y + 120, true);
      state.enemies.push(boss);
      this.bossIntro = 2.2;
      this.emit({ type: "boss", enemy: boss });
      this.sfx("boss");
      return;
    }
    for (const spawn of this.plans[room.gx]) {
      const enemy = this.makeEnemy(spawn.sprites, spawn.x, spawn.y, false, false, spawn.elite);
      state.enemies.push(enemy);
    }
  }

  makeEnemy(sprites: GenerationSprites, x: number, y: number, boss: boolean, minion = false, elite = false): Enemy {
    const family = sprites.familyId as FamilyId;
    const kind: EnemyKind = boss ? "boss" : KIND_BY_FAMILY[family];
    const hpMul = (1 + this.difficulty * 0.32) * (elite ? 1.6 : 1);
    const hp = boss ? 320 : BASE_HP[kind] * hpMul;
    const scale = boss ? 6 : kind === "brute" ? 4 : kind === "kin" ? 2 : 3;
    const r = boss ? 34 : kind === "brute" ? 20 : kind === "kin" ? 11 : 15;
    const speedMul = 1 + this.difficulty * 0.07;
    const speed = ({ rattler: 82, mimic: 70, kin: 62, cell: 42, glitch: 128, drifter: 72, brute: 42, glint: 18, shade: 72, boss: 64 } as const)[kind] * speedMul;
    return {
      uid: this.uid++, kind, family, sprites, x, y, vx: 0, vy: 0, r, hp, maxHp: hp, speed, scale,
      flying: kind === "drifter" || (boss && family === 5), boss, elite, child: false, minion,
      state: "idle", t: this.rng.range(0.4, 1.4), t2: 0, shots: 0, alpha: 1, flash: 0, spawn: 0.5, attack: 0, lift: 0,
      dir: { x: 0, y: 0 }, facing: "down", side: "right", moving: false,
    };
  }

  // ─── Collision ─────────────────────────────────────────────────────────────

  private solidAt(tx: number, ty: number, flying: boolean) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
    if (flying) return false;
    const tile = this.room.tiles[ty][tx];
    return tile === 1 || tile === 2;
  }

  private doorOpen(d: Dir) { return Boolean(this.room.doors[d]) && this.room.cleared; }

  /** Circle vs room interior, tiles and (for the player) open door corridors. */
  walkable(x: number, y: number, r: number, flying: boolean, doors: boolean) {
    const inside = x - r >= IN_X && x + r <= IN_X + IN_W && y - r >= IN_Y && y + r <= IN_Y + IN_H;
    if (!inside) {
      if (!doors) return false;
      const half = TILE / 2 - 2;
      const inX = x - r >= IN_X && x + r <= IN_X + IN_W, inY = y - r >= IN_Y && y + r <= IN_Y + IN_H;
      if (y - r < IN_Y && inX && this.doorOpen("up") && Math.abs(x - CX) + r <= half + 6 && y > IN_Y - WALL - 20) return true;
      if (y + r > IN_Y + IN_H && inX && this.doorOpen("down") && Math.abs(x - CX) + r <= half + 6 && y < IN_Y + IN_H + WALL + 20) return true;
      if (x - r < IN_X && inY && this.doorOpen("left") && Math.abs(y - CY) + r <= half + 6 && x > IN_X - WALL - 20) return true;
      if (x + r > IN_X + IN_W && inY && this.doorOpen("right") && Math.abs(y - CY) + r <= half + 6 && x < IN_X + IN_W + WALL + 20) return true;
      return false;
    }
    const x0 = Math.floor((x - r - IN_X) / TILE), x1 = Math.floor((x + r - IN_X) / TILE);
    const y0 = Math.floor((y - r - IN_Y) / TILE), y1 = Math.floor((y + r - IN_Y) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.solidAt(tx, ty, flying)) continue;
      const rx = IN_X + tx * TILE, ry = IN_Y + ty * TILE;
      const nx = clamp(x, rx + 4, rx + TILE - 4), ny = clamp(y, ry + 4, ry + TILE - 4);
      if (Math.hypot(x - nx, y - ny) < r) return false;
    }
    return true;
  }

  /** Sub-stepped movement with wall sliding. Returns true when blocked. */
  move(body: { x: number; y: number }, dx: number, dy: number, r: number, flying: boolean, doors: boolean) {
    if (!this.walkable(body.x, body.y, r, flying, doors)) {
      // Something placed us inside an obstacle: drift out freely rather than freezing.
      body.x = clamp(body.x + dx, IN_X + r, IN_X + IN_W - r); body.y = clamp(body.y + dy, IN_Y + r, IN_Y + IN_H - r);
      return false;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const nx = body.x + dx / steps, ny = body.y + dy / steps;
      if (this.walkable(nx, ny, r, flying, doors)) { body.x = nx; body.y = ny; continue; }
      blocked = true;
      if (this.walkable(nx, body.y, r, flying, doors)) body.x = nx;
      else if (this.walkable(body.x, ny, r, flying, doors)) body.y = ny;
    }
    return blocked;
  }

  private tearBlocked(x: number, y: number) {
    if (x < IN_X || x > IN_X + IN_W || y < IN_Y || y > IN_Y + IN_H) return true;
    const tx = Math.floor((x - IN_X) / TILE), ty = Math.floor((y - IN_Y) / TILE);
    return this.room.tiles[ty]?.[tx] === 1;
  }

  private tileOf(p: Vec) {
    return [clamp(Math.floor((p.x - IN_X) / TILE), 0, COLS - 1), clamp(Math.floor((p.y - IN_Y) / TILE), 0, ROWS - 1)] as const;
  }

  /** Walker distance field from the player's tile, rebuilt when the player changes tile. */
  private updateFlow() {
    const [px, py] = this.tileOf(this.player);
    const k = `${key(this.room.gx, this.room.gy)}|${px},${py}`;
    if (k === this.flowKey) return;
    this.flowKey = k;
    const grid = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(Infinity));
    grid[py][px] = 0;
    const queue: [number, number][] = [[px, py]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (this.solidAt(nx, ny, false) || grid[ny][nx] !== Infinity) continue;
        grid[ny][nx] = grid[y][x] + 1; queue.push([nx, ny]);
      }
    }
    this.flow = grid;
  }

  private clearLine(a: Vec, b: Vec, flying: boolean) {
    const steps = Math.ceil(dist(a, b) / 14);
    for (let i = 1; i < steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
      const [tx, ty] = this.tileOf({ x, y });
      if (this.solidAt(tx, ty, flying)) return false;
    }
    return true;
  }

  /** Direction toward the player that routes walkers around rocks and pits. */
  private chase(e: Enemy): Vec {
    const p = this.player;
    if (e.flying || this.clearLine(e, p, false)) return norm(p.x - e.x, p.y - e.y);
    const [tx, ty] = this.tileOf(e);
    let best: [number, number] | null = null, bestValue = this.flow[ty]?.[tx] ?? Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = tx + dx, ny = ty + dy;
      if (this.solidAt(nx, ny, false)) continue;
      if (dx && dy && (this.solidAt(tx + dx, ty, false) || this.solidAt(tx, ty + dy, false))) continue;
      const value = this.flow[ny][nx] + (dx && dy ? 0.4 : 0);
      if (value < bestValue) { bestValue = value; best = [nx, ny]; }
    }
    if (!best) return norm(p.x - e.x, p.y - e.y);
    return norm(IN_X + best[0] * TILE + TILE / 2 - e.x, IN_Y + best[1] * TILE + TILE / 2 - e.y);
  }

  /** Nearest open floor point, so drops over rocks or pits stay collectable. */
  private openSpot(p: Vec): Vec {
    const [tx, ty] = this.tileOf(p);
    if (!this.solidAt(tx, ty, false)) return { x: clamp(p.x, IN_X + 16, IN_X + IN_W - 16), y: clamp(p.y, IN_Y + 16, IN_Y + IN_H - 16) };
    return this.freeTiles(0).sort((a, b) => dist(a, p) - dist(b, p))[0] ?? { x: CX, y: CY };
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(dt: number, input: Input) {
    if (this.status !== "playing") { this.updateEffects(dt); return; }
    if (this.choice || this.reviveOffer) return;
    this.ticks++;
    this.time += dt;
    if (this.pendingRoom) {
      // Same duration with or without reduced motion (the renderer hides the fade), so replays match.
      this.fade = Math.min(1, this.fade + dt / 0.09);
      if (this.fade >= 1) {
        const { room, from } = this.pendingRoom;
        this.pendingRoom = null;
        this.enterRoom(room, from);
        this.sfx("door");
      }
      return;
    }
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / 0.12);
    this.bossIntro = Math.max(0, this.bossIntro - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.updatePlayer(dt, input);
    this.updateFamiliars(dt);
    this.updateEnemies(dt);
    this.updateTears(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
    this.checkClear();
    this.checkExits();
  }

  private updatePlayer(dt: number, input: Input) {
    const p = this.player, s = this.stats, keys = input.keys;
    let mx = Number(keys.has("d")) - Number(keys.has("a")), my = Number(keys.has("s")) - Number(keys.has("w"));
    if (!mx && !my && input.move) { mx = input.move.x; my = input.move.y; }
    const mag = Math.min(1, Math.hypot(mx, my));
    p.moving = mag > 0.15;
    if (p.moving) {
      const dir = norm(mx, my), step = s.speed * mag * dt;
      // Door assist: drift toward the doorway's centre line when pushing into an open door.
      for (const d of Object.keys(this.room.doors) as Dir[]) {
        if (!this.doorOpen(d)) continue;
        const [dx, dy] = DOOR_POS[d];
        if ((d === "up" || d === "down") && Math.abs(p.y - dy) < 70 && Math.abs(p.x - dx) < 46 && Math.sign(dir.y) === STEP[d][1]) p.x += clamp(dx - p.x, -120 * dt, 120 * dt);
        if ((d === "left" || d === "right") && Math.abs(p.x - dx) < 70 && Math.abs(p.y - dy) < 46 && Math.sign(dir.x) === STEP[d][0]) p.y += clamp(dy - p.y, -120 * dt, 120 * dt);
      }
      this.move(p, dir.x * step, dir.y * step, p.r, s.flying, true);
      p.facing = Math.abs(dir.x) >= Math.abs(dir.y) ? (dir.x < 0 ? "left" : "right") : (dir.y < 0 ? "up" : "down");
      if (p.facing === "left" || p.facing === "right") p.side = p.facing;
      const last = this.trail[0];
      if (!last || dist(last, p) > 6) { this.trail.unshift({ x: p.x, y: p.y }); if (this.trail.length > 60) this.trail.pop(); }
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.cooldown -= dt;
    let ax = Number(keys.has("arrowright")) - Number(keys.has("arrowleft")), ay = Number(keys.has("arrowdown")) - Number(keys.has("arrowup"));
    if (ax && ay) ay = 0; // Keyboard shots are cardinal, like the classics.
    if (!ax && !ay && input.aim) { ax = input.aim.x; ay = input.aim.y; }
    if (Math.hypot(ax, ay) > 0.2) {
      const aim = norm(ax, ay);
      p.aimDir = aim;
      p.facing = Math.abs(aim.x) >= Math.abs(aim.y) ? (aim.x < 0 ? "left" : "right") : (aim.y < 0 ? "up" : "down");
      if (p.facing === "left" || p.facing === "right") p.side = p.facing;
      if (p.cooldown <= 0) { this.fire(aim); p.cooldown = s.fireDelay; }
    }
  }

  private playerTear(x: number, y: number, dir: Vec, dmg = this.stats.damage, r = this.stats.tearR): Tear {
    const s = this.stats;
    return {
      x, y, vx: dir.x * s.shotSpeed, vy: dir.y * s.shotSpeed, life: s.range, age: 0, r, dmg, friendly: true,
      pierce: s.pierce, split: s.split, homing: s.homing, wobble: s.wobble ? this.rng.range(0, Math.PI * 2) : -1, hit: new Set(),
    };
  }

  private fire(dir: Vec) {
    const p = this.player, s = this.stats;
    const ox = p.x + dir.x * 10, oy = p.y - 24 + dir.y * 10;
    // Inherit a little of the player's motion, like the classics.
    if (s.twin) {
      const px = -dir.y * 9, py = dir.x * 9;
      this.tears.push(this.playerTear(ox + px, oy + py, dir), this.playerTear(ox - px, oy - py, dir));
    } else this.tears.push(this.playerTear(ox, oy, dir));
    p.shots++;
    if (s.burst && p.shots % 6 === 0) {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; this.tears.push(this.playerTear(p.x, p.y - 24, { x: Math.cos(a), y: Math.sin(a) }, s.damage * 0.6, 6)); }
    }
    this.sfx("shoot");
    for (const familiar of this.familiars) if (familiar.cooldown <= 0) {
      this.tears.push(this.playerTear(familiar.x, familiar.y - 10, dir, 2.5, 5));
      familiar.cooldown = Math.max(0.45, s.fireDelay * 1.6);
    }
  }

  private updateFamiliars(dt: number) {
    this.familiars.forEach((familiar, index) => {
      familiar.cooldown -= dt;
      const target = this.trail[Math.min(this.trail.length - 1, 5 + index * 5)] ?? this.player;
      const d = dist(familiar, target);
      if (d > 2) { const k = Math.min(1, dt * 8); familiar.x += (target.x - familiar.x) * k; familiar.y += (target.y - familiar.y) * k; }
    });
  }

  private enemyTear(x: number, y: number, dir: Vec, speed: number, r = 7) {
    this.tears.push({ x, y, vx: dir.x * speed, vy: dir.y * speed, life: 2.6, age: 0, r, dmg: 1, friendly: false,
      pierce: false, split: false, homing: false, wobble: -1, hit: new Set() });
    this.sfx("enemyShot");
  }

  private ring(e: Enemy, count: number, speed: number, offset = 0) {
    for (let i = 0; i < count; i++) { const a = offset + (i / count) * Math.PI * 2; this.enemyTear(e.x, e.y - e.r, { x: Math.cos(a), y: Math.sin(a) }, speed); }
  }

  private teleportSpot(e: Enemy, minDistance: number, near?: number) {
    const tiles = this.freeTiles(minDistance, e.flying).filter(t => near === undefined || dist(t, this.player) < near);
    return tiles.length ? this.rng.pick(tiles) : { x: e.x, y: e.y };
  }

  private updateEnemies(dt: number) {
    const p = this.player, state = this.state;
    this.updateFlow();
    for (const e of state.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      if (e.spawn > 0) { e.spawn -= dt; continue; }
      if (e.boss && this.bossIntro > 0) continue;
      const direct = norm(p.x - e.x, p.y - e.y), d = dist(e, p);
      const toPlayer = e.kind === "glitch" || e.kind === "drifter" ? direct : this.chase(e);
      let vx = 0, vy = 0;
      e.t -= dt;
      switch (e.kind) {
        case "rattler": vx = toPlayer.x * e.speed; vy = toPlayer.y * e.speed; break;
        case "mimic": {
          if (e.state === "blinkOut") { e.alpha = Math.max(0, e.alpha - dt / 0.3); if (e.alpha <= 0) { Object.assign(e, this.teleportSpot(e, 200)); e.state = "blinkIn"; } break; }
          if (e.state === "blinkIn") { e.alpha = Math.min(1, e.alpha + dt / 0.3); if (e.alpha >= 1) { e.state = "idle"; e.t = 1.2; } break; }
          const side = { x: -toPlayer.y, y: toPlayer.x };
          const want = d < 190 ? -1 : d > 270 ? 1 : 0;
          vx = (toPlayer.x * want + side.x * 0.6) * e.speed; vy = (toPlayer.y * want + side.y * 0.6) * e.speed;
          if (e.t <= 0) {
            this.enemyTear(e.x, e.y - 20, norm(p.x - e.x, p.y - 24 - (e.y - 20)), 210);
            e.shots++; e.t = 1.7;
            if (e.shots % 2 === 0) e.state = "blinkOut";
          }
          break;
        }
        case "kin": {
          if (e.state === "lunge") { vx = e.dir.x * 250; vy = e.dir.y * 250; if (e.t <= 0) { e.state = "idle"; e.t = this.rng.range(1.6, 2.6); } break; }
          if (e.t2 <= 0) { const a = this.rng.range(0, Math.PI * 2); e.dir = { x: Math.cos(a), y: Math.sin(a) }; e.t2 = this.rng.range(0.8, 1.6); }
          e.t2 -= dt;
          vx = e.dir.x * e.speed; vy = e.dir.y * e.speed;
          if (e.t <= 0 && d < 320 && this.clearLine(e, p, false)) { e.state = "lunge"; e.dir = direct; e.t = 0.35; }
          else if (e.t <= 0) e.t = 0.5;
          break;
        }
        case "cell": { const wobble = Math.sin(this.time * 3 + e.uid); vx = (toPlayer.x - toPlayer.y * wobble * 0.5) * e.speed; vy = (toPlayer.y + toPlayer.x * wobble * 0.5) * e.speed; break; }
        case "glitch": {
          if (e.t2 <= 0) {
            const angle = this.rng.chance(0.5) ? Math.atan2(toPlayer.y, toPlayer.x) : this.rng.range(0, Math.PI * 2);
            const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            e.dir = { x: Math.cos(snapped), y: Math.sin(snapped) }; e.t2 = this.rng.range(0.25, 0.6);
          }
          e.t2 -= dt; vx = e.dir.x * e.speed; vy = e.dir.y * e.speed;
          if (e.t <= 0) {
            const a = Math.PI / 4 + this.rng.int(4) * Math.PI / 2;
            this.enemyTear(e.x, e.y - 18, { x: Math.cos(a), y: Math.sin(a) }, 190);
            e.t = this.rng.range(1.8, 2.6);
          }
          break;
        }
        case "drifter": { const wave = Math.sin(this.time * 2.4 + e.uid) * 0.9; vx = (toPlayer.x - toPlayer.y * wave) * e.speed; vy = (toPlayer.y + toPlayer.x * wave) * e.speed; break; }
        case "brute": {
          if (e.state === "windup") { if (e.t <= 0) { e.state = "charge"; e.t = 1.4; } break; }
          if (e.state === "charge") {
            const blocked = this.move(e, e.dir.x * 330 * dt, e.dir.y * 330 * dt, e.r, false, false);
            e.moving = true;
            if (blocked || e.t <= 0) { e.state = "stun"; e.t = 0.9; if (blocked && !this.reducedMotion) this.shake = 0.15; }
            continue;
          }
          if (e.state === "stun") { if (e.t <= 0) { e.state = "idle"; e.t = 0.6; } break; }
          vx = toPlayer.x * e.speed; vy = toPlayer.y * e.speed;
          const aligned = Math.abs(p.x - e.x) < 26 ? { x: 0, y: Math.sign(p.y - e.y) } : Math.abs(p.y - e.y) < 26 ? { x: Math.sign(p.x - e.x), y: 0 } : null;
          if (aligned && e.t <= 0 && d < 520) { e.state = "windup"; e.dir = aligned; e.t = 0.45; vx = vy = 0; }
          break;
        }
        case "glint": {
          if (e.t2 <= 0) { const a = this.rng.range(0, Math.PI * 2); e.dir = { x: Math.cos(a), y: Math.sin(a) }; e.t2 = 1.5; }
          e.t2 -= dt; vx = e.dir.x * e.speed; vy = e.dir.y * e.speed;
          if (e.t <= 0) { this.ring(e, this.difficulty < 1 ? 6 : 8, 150, this.rng.range(0, 1)); e.t = 2.6; }
          break;
        }
        case "shade": {
          if (e.state === "idle") { vx = toPlayer.x * e.speed; vy = toPlayer.y * e.speed; if (e.t <= 0) { e.state = "out"; } }
          else if (e.state === "out") { e.alpha = Math.max(0, e.alpha - dt / 0.4); if (e.alpha <= 0) { e.state = "hidden"; e.t = 0.9; } }
          else if (e.state === "hidden") { if (e.t <= 0) { Object.assign(e, this.teleportSpot(e, 100, 200)); e.state = "in"; } }
          else if (e.state === "in") { e.alpha = Math.min(1, e.alpha + dt / 0.45); if (e.alpha >= 1) { e.state = "idle"; e.t = 2.4; } }
          break;
        }
        case "boss": this.updateBoss(e, dt, direct, d); continue;
      }
      e.moving = Math.hypot(vx, vy) > 1;
      if (e.moving) {
        this.move(e, vx * dt, vy * dt, e.r, e.flying, false);
        const f = Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? "left" : "right") : (vy < 0 ? "up" : "down");
        e.facing = f; if (f === "left" || f === "right") e.side = f;
      }
    }
    // Keep enemies from stacking on one another.
    const list = state.enemies;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], dd = dist(a, b), min = (a.r + b.r) * 0.85;
      if (dd > 0 && dd < min) {
        const push = (min - dd) / 2, nx = (b.x - a.x) / dd, ny = (b.y - a.y) / dd;
        if (!a.boss) this.move(a, -nx * push, -ny * push, a.r, a.flying, false);
        if (!b.boss) this.move(b, nx * push, ny * push, b.r, b.flying, false);
      }
    }
    // Contact damage.
    for (const e of list) {
      if (e.spawn > 0 || e.alpha < 0.6 || (e.boss && this.bossIntro > 0)) continue;
      if (dist(e, p) < e.r + p.r - 4) this.hurtPlayer(1, e);
    }
  }

  private updateBoss(e: Enemy, dt: number, toPlayer: Vec, d: number) {
    // The Daily Crypt keeper knows one more trick than its family's usual three.
    const attacks = [...BOSS_ATTACKS[e.family], EXTRA_ATTACK[e.family]];
    const enraged = e.hp < e.maxHp * 0.5;
    const setFacing = (x: number, y: number) => {
      const f = Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
      e.facing = f; if (f === "left" || f === "right") e.side = f;
    };
    switch (e.state) {
      case "idle": {
        e.moving = d > 120;
        if (e.moving) { this.move(e, toPlayer.x * e.speed * dt, toPlayer.y * e.speed * dt, e.r, e.flying, false); setFacing(toPlayer.x, toPlayer.y); }
        if (e.t <= 0) {
          const attack: BossAttack = attacks[e.attack % attacks.length];
          e.attack++;
          this.startBossAttack(e, attack, enraged, toPlayer);
        }
        return;
      }
      case "charge-windup": if (e.t <= 0) { e.state = "charge"; e.t = 0.9; } return;
      case "charge": {
        e.moving = true;
        const blocked = this.move(e, e.dir.x * 400 * dt, e.dir.y * 400 * dt, e.r, e.flying, false);
        if (blocked || e.t <= 0) {
          if (blocked && !this.reducedMotion) this.shake = 0.25;
          if (blocked) this.ring(e, enraged ? 10 : 6, 160);
          this.bossRest(e, enraged);
        }
        return;
      }
      case "spiral": {
        e.t2 -= dt;
        if (e.t2 <= 0) {
          e.shots++;
          const a = e.shots * 0.55;
          this.enemyTear(e.x, e.y - e.r, { x: Math.cos(a), y: Math.sin(a) }, 165);
          if (enraged) this.enemyTear(e.x, e.y - e.r, { x: Math.cos(a + Math.PI), y: Math.sin(a + Math.PI) }, 165);
          e.t2 = 0.075;
        }
        if (e.t <= 0) this.bossRest(e, enraged);
        return;
      }
      case "blink-out": {
        e.alpha = Math.max(0, e.alpha - dt / 0.35);
        if (e.alpha <= 0) { Object.assign(e, this.teleportSpot(e, 220)); e.state = "blink-in"; }
        return;
      }
      case "blink-in": {
        e.alpha = Math.min(1, e.alpha + dt / 0.35);
        if (e.alpha >= 1) {
          const aim = norm(this.player.x - e.x, this.player.y - e.y);
          const base = Math.atan2(aim.y, aim.x), n = enraged ? 7 : 5;
          for (let i = 0; i < n; i++) { const a = base + (i - (n - 1) / 2) * 0.22; this.enemyTear(e.x, e.y - e.r, { x: Math.cos(a), y: Math.sin(a) }, 220); }
          this.bossRest(e, enraged);
        }
        return;
      }
      case "slam-up": {
        e.lift = Math.sin((1 - e.t / 0.7) * Math.PI) * 60;
        if (e.t <= 0) {
          e.lift = 0;
          this.ring(e, enraged ? 16 : 11, 175);
          if (!this.reducedMotion) this.shake = 0.3;
          this.bossRest(e, enraged);
        }
        return;
      }
      case "rest": if (e.t <= 0) { e.state = "idle"; e.t = enraged ? 0.5 : 0.9; } return;
    }
  }

  private bossRest(e: Enemy, enraged: boolean) { e.state = "rest"; e.t = enraged ? 0.45 : 0.8; e.moving = false; }

  private startBossAttack(e: Enemy, attack: BossAttack, enraged: boolean, toPlayer: Vec) {
    switch (attack) {
      case "ring": this.ring(e, enraged ? 16 : 12, 170, this.rng.range(0, 1)); this.bossRest(e, enraged); break;
      case "spread": {
        const base = Math.atan2(toPlayer.y, toPlayer.x), n = enraged ? 7 : 5;
        for (let i = 0; i < n; i++) { const a = base + (i - (n - 1) / 2) * 0.2; this.enemyTear(e.x, e.y - e.r, { x: Math.cos(a), y: Math.sin(a) }, 225); }
        this.bossRest(e, enraged); break;
      }
      case "charge": e.state = "charge-windup"; e.dir = toPlayer; e.t = 0.55; e.moving = false; break;
      case "summon": {
        const minions = this.state.enemies.filter(other => other.minion).length;
        const count = Math.min(enraged ? 3 : 2, 4 - minions);
        for (let i = 0; i < count; i++) {
          const spot = this.teleportSpot(e, 140);
          const minion = this.makeEnemy(this.rng.pick(this.cast.regulars), spot.x, spot.y, false, true);
          minion.maxHp = minion.hp = minion.hp * 0.7;
          this.state.enemies.push(minion);
        }
        this.bossRest(e, enraged); break;
      }
      case "spiral": e.state = "spiral"; e.t = enraged ? 1.8 : 1.3; e.t2 = 0; break;
      case "blink": e.state = "blink-out"; break;
      case "slam": e.state = "slam-up"; e.t = 0.7; break;
    }
  }

  hurtPlayer(amount: number, source?: Vec) {
    const p = this.player;
    if (p.invuln > 0 || this.status !== "playing") return;
    void amount;
    this.hits++;
    p.hp = Math.max(0, this.guard - this.hits);
    p.invuln = Math.min(this.stats.invuln, 1.2);
    this.texts.push({ x: p.x, y: p.y - 70, text: `+${HIT_PENALTY}s`, life: 1, color: "#ff5a6a" });
    this.emit({ type: "hit", hits: this.hits });
    this.sfx("hurt");
    if (!this.reducedMotion) this.shake = 0.25;
    if (source) { const push = norm(p.x - source.x, p.y - source.y); this.move(p, push.x * 24, push.y * 24, p.r, this.stats.flying, false); }
    this.burst(p.x, p.y - 20, "#ffffff", 10);
    if (p.hp <= 0) {
      if (this.revivesLeft > 0) { this.reviveOffer = true; this.emit({ type: "revive-offer" }); }
      else this.die();
    }
  }

  private die() { this.status = "dead"; this.sfx("lose"); this.emit({ type: "dead" }); }

  /** Accept the pending continue: +REVIVE_GUARD guard, enemy shots cleared, a moment of invulnerability. */
  revive() {
    if (!this.reviveOffer || this.revivesLeft <= 0) return false;
    this.reviveOffer = false; this.revivesLeft--; this.revives++;
    this.guard += REVIVE_GUARD;
    this.player.hp = this.guard - this.hits;
    this.player.invuln = 1.5;
    this.tears = this.tears.filter(tear => tear.friendly);
    this.texts.push({ x: this.player.x, y: this.player.y - 70, text: `+${REVIVE_GUARD} guard`, life: 1.2, color: "#ccff00" });
    this.emit({ type: "revived" }); this.sfx("relic");
    return true;
  }

  /** Refuse the pending continue: the run ends here. */
  declineRevive() {
    if (!this.reviveOffer) return false;
    this.reviveOffer = false;
    this.die();
    return true;
  }

  private damageEnemy(e: Enemy, amount: number) {
    if (e.alpha < 0.5 || e.spawn > 0) return false;
    e.hp -= amount; e.flash = 0.1;
    this.sfx("hit");
    if (e.hp > 0) return true;
    this.killEnemy(e);
    return true;
  }

  private killEnemy(e: Enemy) {
    const state = this.state;
    state.enemies = state.enemies.filter(other => other !== e);
    this.kills++;
    this.burst(e.x, e.y - e.r, this.theme.accent, e.boss ? 60 : 16);
    this.burst(e.x, e.y - e.r, "#000000", e.boss ? 30 : 8);
    this.sfx("kill");
    if (!e.minion && !e.child && !this.defeated.some(entry => entry.id === e.sprites.tokenId))
      this.defeated.push({ id: e.sprites.tokenId, family: e.family, sprites: e.sprites, boss: e.boss });
    this.texts.push({ x: e.x, y: e.y - e.r * 2 - 10, text: `#${e.sprites.tokenId}`, life: 1.1, color: "#ffffff" });
    if (e.kind === "cell" && !e.child) {
      for (const side of [-1, 1]) {
        const child = this.makeEnemy(e.sprites, e.x + side * 14, e.y, false, e.minion);
        Object.assign(child, { child: true, scale: 2, r: 10, hp: e.maxHp * 0.4, maxHp: e.maxHp * 0.4, speed: e.speed * 1.7, spawn: 0.15, elite: false });
        state.enemies.push(child);
      }
    }
    if (e.boss) {
      // The run ends the moment the keeper falls: the clock stops here.
      state.enemies = [];
      this.tears = [];
      this.room.cleared = true;
      this.reviveOffer = false;
      this.status = "won";
      this.sfx("win");
      this.emit({ type: "won" });
    }
  }

  private updateTears(dt: number) {
    const p = this.player, enemies = this.state.enemies, spawned: Tear[] = [];
    for (const tear of this.tears) {
      tear.age += dt;
      if (tear.homing && tear.friendly) {
        let best: Enemy | null = null, bestD = 220;
        for (const e of enemies) { const d = dist(e, tear); if (d < bestD && e.alpha > 0.5) { best = e; bestD = d; } }
        if (best) {
          const want = norm(best.x - tear.x, best.y - (tear.y + 0) - best.r * 0.5), speed = Math.hypot(tear.vx, tear.vy);
          const k = Math.min(1, dt * 5);
          const dir = norm(tear.vx / speed * (1 - k) + want.x * k, tear.vy / speed * (1 - k) + want.y * k);
          tear.vx = dir.x * speed; tear.vy = dir.y * speed;
        }
      }
      let x = tear.x + tear.vx * dt, y = tear.y + tear.vy * dt;
      if (tear.wobble >= 0) {
        const speed = Math.hypot(tear.vx, tear.vy) || 1, side = Math.cos(tear.age * 16 + tear.wobble) * 120 * dt;
        x += -tear.vy / speed * side; y += tear.vx / speed * side;
      }
      tear.x = x; tear.y = y;
      // Shots fly at shoulder height; test the floor point below them against rocks.
      if (tear.friendly) {
        for (const e of enemies) {
          if (tear.hit.has(e.uid)) continue;
          const cy = e.y - e.r - e.lift;
          if (Math.hypot(tear.x - e.x, tear.y - cy) > e.r + tear.r + 2) continue;
          if (!this.damageEnemy(e, tear.dmg)) continue;
          tear.hit.add(e.uid);
          const kb = e.boss ? 0 : e.kind === "brute" ? 4 : 10, dir = norm(tear.vx, tear.vy);
          if (kb && e.hp > 0) this.move(e, dir.x * kb, dir.y * kb, e.r, e.flying, false);
          if (tear.split) {
            const a = Math.atan2(tear.vy, tear.vx), speed = Math.hypot(tear.vx, tear.vy);
            for (const offset of [-0.7, 0.7]) spawned.push({ ...tear, vx: Math.cos(a + offset) * speed, vy: Math.sin(a + offset) * speed,
              age: 0, life: 0.35, r: Math.max(4, tear.r * 0.6), dmg: tear.dmg * 0.5, split: false, pierce: false, hit: new Set([e.uid]) });
          }
          if (!tear.pierce) { tear.life = -1; this.splash(tear); break; }
        }
      } else if (Math.hypot(tear.x - p.x, tear.y - (p.y - 24)) < tear.r + p.r - 3) {
        tear.life = -1; this.splash(tear);
        this.hurtPlayer(1, { x: tear.x - tear.vx, y: tear.y - tear.vy });
      }
      if (tear.life < 0) continue;
      if (tear.age < dt * 1.5) tear.airborne = this.tearBlocked(tear.x, tear.y + 20);
      const blocked = this.tearBlocked(tear.x, tear.y + 20);
      if (!blocked) tear.airborne = false;
      const outside = tear.x < IN_X || tear.x > IN_X + IN_W || tear.y < IN_Y - 24 || tear.y > IN_Y + IN_H;
      if (tear.age >= tear.life || outside || (blocked && !tear.airborne)) { tear.life = -1; this.splash(tear); }
    }
    this.tears = this.tears.filter(tear => tear.life > 0).concat(spawned);
  }

  private splash(tear: Tear) {
    const color = tear.friendly ? "#ffffff" : this.theme.accent;
    for (let i = 0; i < 4; i++) {
      const a = this.fx.range(0, Math.PI * 2), s = this.fx.range(30, 90);
      this.particles.push({ x: tear.x, y: tear.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, max: 0.25, color, size: 3 });
    }
  }

  private burst(x: number, y: number, color: string, count: number) {
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const a = this.fx.range(0, Math.PI * 2), s = this.fx.range(40, 220);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: this.fx.range(0.3, 0.7), max: 0.7, color, size: this.fx.chance(0.3) ? 6 : 4 });
    }
  }

  private updatePickups(dt: number) {
    const p = this.player, state = this.state, s = this.stats;
    state.pickups = state.pickups.filter(item => {
      item.t += dt;
      if (item.t < 0.3 || dist(item, p) > p.r + 14) return true;
      if ((item.kind === "heart" || item.kind === "half") && p.hp >= s.maxHp) return true;
      if (item.kind === "heart") p.hp = Math.min(s.maxHp, p.hp + 2);
      else if (item.kind === "half") p.hp = Math.min(s.maxHp, p.hp + 1);
      else this.sparks++;
      this.texts.push({ x: item.x, y: item.y - 20, text: item.kind === "spark" ? "+1 spark" : "+heart", life: 0.8, color: item.kind === "spark" ? "#ccff00" : "#ff6b6b" });
      this.sfx("pickup");
      return false;
    });
    const pedestal = state.pedestal;
    if (pedestal && !pedestal.taken && dist(pedestal, p) < p.r + 22) {
      pedestal.taken = true;
      this.takeRelic(pedestal.relic);
    }
  }

  private takeRelic(id: RelicId | "heart") {
    const s = this.stats, p = this.player;
    if (id === "heart") { s.maxHp += 2; p.hp = s.maxHp; this.emit({ type: "toast", title: "Heart container", text: "+1 heart." }); this.sfx("relic"); return; }
    const relic = RELICS.find(item => item.id === id)!;
    this.relics.push(id);
    switch (id) {
      case "marrow": s.maxHp += 2; p.hp = s.maxHp; break;
      case "mask": s.damage += 1; break;
      case "photo": s.familiars = Math.min(2, s.familiars + 1); this.syncFamiliars(); break;
      case "petri": s.split = true; break;
      case "lens": s.fireDelay = Math.max(0.15, s.fireDelay * 0.75); break;
      case "boots": s.flying = true; break;
      case "knuckle": s.tearR += 3; s.damage *= 1.3; break;
      case "dust": s.shotSpeed += 90; s.range += 0.2; break;
      case "hollowheart": s.speed += 30; s.invuln += 0.4; break;
      case "signal": s.homing = true; break;
    }
    this.emit({ type: "toast", title: relic.name, text: relic.text });
    this.sfx("relic");
  }

  private updateEffects(dt: number) {
    for (const particle of this.particles) {
      particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= 0.9; particle.vy *= 0.9;
    }
    this.particles = this.particles.filter(particle => particle.life > 0);
    for (const text of this.texts) { text.life -= dt; text.y -= 30 * dt; }
    this.texts = this.texts.filter(text => text.life > 0);
  }

  private checkClear() {
    const room = this.room, state = this.state;
    if (room.cleared || state.enemies.length) return;
    room.cleared = true;
    this.tears = this.tears.filter(tear => tear.friendly);
    this.sfx("door");
    // After room 5 the crypt offers today's three power-ups. The clock stops while you choose.
    if (room.gx === 4 && this.choiceOptions.length) { this.choice = this.choiceOptions; this.emit({ type: "choice", options: this.choice }); }
  }

  /** Apply the chosen power-up (index into choiceOptions). Recorded in the replay at the current tick. */
  choose(index: number) {
    if (!this.choice || !Number.isInteger(index) || index < 0 || index >= this.choice.length) return false;
    const id = this.choice[index];
    this.choice = null;
    this.takeRelic(id);
    return true;
  }

  private checkExits() {
    const p = this.player, room = this.room;
    const exits: [Dir, boolean][] = [
      ["up", p.y < IN_Y - 14], ["down", p.y > IN_Y + IN_H + 14], ["left", p.x < IN_X - 14], ["right", p.x > IN_X + IN_W + 14],
    ];
    for (const [d, crossed] of exits) {
      if (!crossed || !this.doorOpen(d)) continue;
      const next = this.floor.rooms.get(key(room.gx + STEP[d][0], room.gy + STEP[d][1]));
      if (next) { this.pendingRoom = { room: next, from: OPPOSITE[d] }; return; }
    }
  }

  drainEvents() { const events = this.events; this.events = []; return events; }
}

export const FAMILY_OF = (sprites: GenerationSprites) => sprites.familyId as FamilyId;

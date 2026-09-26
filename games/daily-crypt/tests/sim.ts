// Headless engine check: a bot plays full runs (no DOM, no network). Run: node games/binding-of-rarefriend/tests/run-sim.mjs
import { decodeGenerationSprites, type GenerationSprites } from "../../../src/generation-sprites";
import { sampleFriendSprites } from "../../../examples/fishing/sample-sprites";
import { Game, CX, CY, DOOR_POS, IN_X, IN_Y, TILE, TICK, type Input } from "../engine/game";
import { Recorder, quantize, result, toInput, verify, type RunRecord } from "../engine/replay";
import { COLS, ROWS, STEP, OPPOSITE, key, type Dir, type Room } from "../engine/dungeon";
import type { Roster } from "../engine/roster";
import type { FamilyId } from "../engine/themes";

const base = [sampleFriendSprites(7730n)!, sampleFriendSprites(3412n)!];
export const fakeSprites = (id: number, family: number): GenerationSprites => decodeGenerationSprites(BigInt(id), family, id, base[id % 2].frames);

export function fakeRoster(families: FamilyId[]): Roster {
  let id = 100;
  return { sampled: 0, floors: families.map(family => ({ family, boss: fakeSprites(id++, family), regulars: [0, 1, 2, 3, 4].map(() => fakeSprites(id++, family)) })) };
}

function tilePath(game: Game, from: { x: number; y: number }, to: { x: number; y: number }, flying: boolean) {
  const t = (p: { x: number; y: number }) => [Math.max(0, Math.min(COLS - 1, Math.floor((p.x - IN_X) / TILE))), Math.max(0, Math.min(ROWS - 1, Math.floor((p.y - IN_Y) / TILE)))];
  const [sx, sy] = t(from), [ex, ey] = t(to);
  const prev = new Map<string, string | null>([[key(sx, sy), null]]), q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === ex && y === ey) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || prev.has(key(nx, ny))) continue;
      const tile = game.room.tiles[ny][nx];
      if (tile === 1 || (tile === 2 && !flying)) continue;
      prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
    }
  }
  let cur: string | null = key(ex, ey); const path: string[] = [];
  while (cur && cur !== key(sx, sy)) { path.unshift(cur); cur = prev.get(cur) ?? null; if (!prev.has(path[0])) return null; }
  const next = path[0];
  if (!next) return to;
  const [nx, ny] = next.split(",").map(Number);
  return path.length === 1 ? to : { x: IN_X + nx * TILE + TILE / 2, y: IN_Y + ny * TILE + TILE / 2 };
}

function nextDoor(game: Game): Dir | null {
  // BFS over rooms to the nearest unvisited (or boss when all visited) room.
  const start = game.room, prev = new Map<Room, [Room, Dir] | null>([[start, null]]), q = [start];
  let goal: Room | null = null;
  while (q.length) {
    const r = q.shift()!;
    if (r !== start && !r.visited) { goal = r; break; }
    for (const d of Object.keys(r.doors) as Dir[]) {
      const n = game.floor.rooms.get(key(r.gx + STEP[d][0], r.gy + STEP[d][1]))!;
      if (!prev.has(n)) { prev.set(n, [r, d]); q.push(n); }
    }
  }
  if (!goal) goal = game.floor.boss === start ? null : game.floor.boss;
  if (!goal) return null;
  let cur = goal, dir: Dir | null = null;
  while (prev.get(cur)) { const [p, d] = prev.get(cur)!; dir = d; cur = p; }
  return dir;
}

export function botInput(game: Game, input: Input) {
    const p = game.player, enemies = game.state.enemies.filter(e => e.alpha > 0.5);
    input.move = null; input.aim = null;
    let target: { x: number; y: number } | null = null;
    if (enemies.length) {
      const e = enemies.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      const dx = e.x - p.x, dy = e.y - e.r - (p.y - 24), l = Math.hypot(dx, dy);
      input.aim = { x: dx / l, y: dy / l };
      // keep medium distance
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      target = d > 200 ? e : d < 130 ? { x: p.x - (e.x - p.x), y: p.y - (e.y - p.y) } : null;
      if (target) target = { x: Math.max(IN_X + 20, Math.min(IN_X + 700, target.x)), y: Math.max(IN_Y + 20, Math.min(IN_Y + 370, target.y)) };
    } else {
      const ped = game.state.pedestal;
      const pick = game.state.pickups.find(x => x.kind === "spark");
      if (ped && !ped.taken) target = ped;
      else if (pick) target = pick;
      else if (game.state.trapdoor) target = { x: CX, y: CY };
      else {
        const d = nextDoor(game);
        if (d) { const [x, y] = DOOR_POS[d]; target = { x: x + STEP[d][0] * 40, y: y + STEP[d][1] * 40 }; }
      }
    }
    if (target) {
      const way = tilePath(game, p, target, game.stats.flying) ?? target;
      const dx = way.x - p.x, dy = way.y - p.y, l = Math.hypot(dx, dy);
      if (l > 3) input.move = { x: dx / l, y: dy / l };
    }
    return enemies;
}

export function run(seed: number, family: FamilyId, families: FamilyId[], god: boolean, onTick?: (game: Game, t: number) => boolean | void) {
  const roster = fakeRoster(families), sprites = fakeSprites(7730, family);
  const game = new Game(sprites, family, roster, seed);
  const input: Input = { keys: new Set(), move: null, aim: null };
  const recorder = new Recorder();
  const dt = TICK;
  let t = 0, stuck = 0, last = { x: 0, y: 0 }, lastRoom = game.room, roomTime = 0;
  const log: string[] = [];
  while (game.status === "playing" && t < 60 * 15) {
    if (game.choice) { recorder.choices.push(0); game.choose(0); continue; }
    t += dt; roomTime += dt;
    if (game.room !== lastRoom) { lastRoom = game.room; roomTime = 0; }
    if (god) game.player.invuln = 1;
    const enemies = botInput(game, input);
    const p = game.player;
    const frame = quantize(input.move, input.aim);
    recorder.push(frame);
    game.update(dt, toInput(frame));
    if (onTick && onTick(game, t)) break;
    for (const ev of game.drainEvents()) if (ev.type === "room" || ev.type === "boss" || ev.type === "choice") log.push(`${t.toFixed(0)}s ${ev.type}`);
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.01 && !enemies.length) stuck += dt; else stuck = 0;
    last = { x: p.x, y: p.y };
    if (stuck > 8 || roomTime > 120) { log.push(`STUCK in room ${game.roomIndex + 1} at ${p.x.toFixed(0)},${p.y.toFixed(0)} enemies=${game.state.enemies.map(e => `${e.kind}:${e.state}:hp${e.hp.toFixed(1)}@${e.x.toFixed(0)},${e.y.toFixed(0)}`).join(' ')}`); break; }
  }
  const record: RunRecord = { seed, friendId: 7730n, family, frames: recorder.frames(), choices: recorder.choices, claimed: result(game) };
  // god mode tampers with the sim, so only honest runs are expected to verify.
  const verified = god ? null : verify(record, sprites, roster).ok;
  return { status: game.status, room: game.roomIndex + 1, time: game.finalTime, ticks: game.ticks, hits: game.hits, kills: game.kills, relics: game.relics, verified, log };
}

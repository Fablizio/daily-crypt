/** Isaac-style floor layout: a grid of single-screen rooms joined by doors. */
import type { Rng } from "./rng";

export const COLS = 13, ROWS = 7;
export const GRID = 9;
export type Dir = "up" | "down" | "left" | "right";
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];
export const STEP: Readonly<Record<Dir, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: "down", down: "up", left: "right", right: "left" };

export type RoomKind = "start" | "normal" | "treasure" | "boss";
/** 0 floor, 1 rock (blocks walkers and shots), 2 pit (blocks walkers only). */
export type Tile = 0 | 1 | 2;
export type Room = {
  gx: number; gy: number; kind: RoomKind;
  doors: Partial<Record<Dir, true>>;
  tiles: Tile[][];
  visited: boolean; seen: boolean; cleared: boolean;
  distance: number;
};
export type Floor = { rooms: Map<string, Room>; start: Room; boss: Room; treasure: Room | null };
export const key = (gx: number, gy: number) => `${gx},${gy}`;

// Templates: R rock, P pit. Door approaches are forced clear and every layout is checked for connectivity.
const LAYOUTS = [
  [".............", ".............", ".............", ".............", ".............", ".............", "............."],
  [".............", ".R.........R.", ".............", ".............", ".............", ".R.........R.", "............."],
  [".............", "...R.....R...", "...R.....R...", ".............", "...R.....R...", "...R.....R...", "............."],
  [".............", ".............", "....RR.RR....", "....R...R....", "....RR.RR....", ".............", "............."],
  [".............", "..PPP...PPP..", "..P.......P..", ".............", "..P.......P..", "..PPP...PPP..", "............."],
  [".............", ".....P.P.....", "....PP.PP....", "...PP...PP...", "....PP.PP....", ".....P.P.....", "............."],
  ["RR.........RR", "R...........R", ".............", ".............", ".............", "R...........R", "RR.........RR"],
  [".............", ".RR.RR.RR.RR.", ".............", ".............", ".............", ".RR.RR.RR.RR.", "............."],
  [".............", "..R.......R..", ".R.R.....R.R.", ".............", ".R.R.....R.R.", "..R.......R..", "............."],
  [".............", ".............", "..RRRR.RRRR..", ".............", "..RRRR.RRRR..", ".............", "............."],
  [".....P.P.....", ".....P.P.....", ".....P.P.....", ".............", ".....P.P.....", ".....P.P.....", ".....P.P....."],
  [".............", ".P.P.P.P.P.P.", ".............", ".P.P.P.P.P.P.", ".............", ".P.P.P.P.P.P.", "............."],
  ["R...........R", ".............", "...PPP.PPP...", "...P.....P...", "...PPP.PPP...", ".............", "R...........R"],
] as const;

function parseLayout(rows: readonly string[], rng: Rng): Tile[][] {
  const flipX = rng.chance(0.5), flipY = rng.chance(0.5);
  return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
    const c = rows[flipY ? ROWS - 1 - y : y][flipX ? COLS - 1 - x : x];
    return c === "R" ? 1 : c === "P" ? 2 : 0;
  }));
}

const DOOR_TILES: Readonly<Record<Dir, readonly [number, number][]>> = {
  up: [[6, 0], [6, 1]], down: [[6, 6], [6, 5]], left: [[0, 3], [1, 3]], right: [[12, 3], [11, 3]],
};

function connected(tiles: Tile[][], doors: Dir[]) {
  const [sx, sy] = [6, 3];
  if (tiles[sy][sx] !== 0) return false;
  const seen = new Set([key(sx, sy)]), queue: [number, number][] = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || tiles[ny][nx] !== 0 || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny)); queue.push([nx, ny]);
    }
  }
  const open = tiles.flat().filter(tile => tile === 0).length;
  return doors.every(door => seen.has(key(...DOOR_TILES[door][0]))) && seen.size === open;
}

export function makeTiles(kind: RoomKind, doors: Dir[], rng: Rng): Tile[][] {
  if (kind !== "normal") return parseLayout(LAYOUTS[0], rng);
  for (let attempt = 0; attempt < 8; attempt++) {
    const tiles = parseLayout(rng.pick(LAYOUTS.slice(1)), rng);
    for (const door of DIRS) for (const [x, y] of DOOR_TILES[door]) tiles[y][x] = 0;
    tiles[3][6] = 0;
    if (connected(tiles, doors)) return tiles;
  }
  return parseLayout(LAYOUTS[0], rng);
}

export function generateFloor(rng: Rng, depth: number): Floor {
  const target = Math.min(7 + depth * 2, 14);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = new Map<string, [number, number]>();
    const center = Math.floor(GRID / 2);
    cells.set(key(center, center), [center, center]);
    const queue: [number, number][] = [[center, center]];
    const neighbours = (x: number, y: number) => DIRS.filter(d => cells.has(key(x + STEP[d][0], y + STEP[d][1]))).length;
    let guard = 0;
    while (queue.length && cells.size < target && guard++ < 600) {
      const [x, y] = queue.shift()!;
      for (const d of rng.shuffle([...DIRS])) {
        const nx = x + STEP[d][0], ny = y + STEP[d][1];
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || cells.has(key(nx, ny))) continue;
        if (cells.size >= target || neighbours(nx, ny) > 1 || rng.chance(0.45)) continue;
        cells.set(key(nx, ny), [nx, ny]); queue.push([nx, ny]);
      }
      if (!queue.length && cells.size < target) queue.push(rng.pick([...cells.values()]));
    }
    if (cells.size < target) continue;
    // Distances from the start room.
    const distance = new Map([[key(center, center), 0]]);
    const bfs: [number, number][] = [[center, center]];
    while (bfs.length) {
      const [x, y] = bfs.shift()!;
      for (const d of DIRS) {
        const k = key(x + STEP[d][0], y + STEP[d][1]);
        if (cells.has(k) && !distance.has(k)) { distance.set(k, distance.get(key(x, y))! + 1); bfs.push(cells.get(k)!); }
      }
    }
    const deadEnds = [...cells.values()].filter(([x, y]) => (x !== center || y !== center) && neighbours(x, y) === 1)
      .sort((a, b) => distance.get(key(...b))! - distance.get(key(...a))!);
    if (deadEnds.length < 2 || distance.get(key(...deadEnds[0]))! < 3) continue;
    const bossCell = deadEnds[0], treasureCell = deadEnds[1];
    const rooms = new Map<string, Room>();
    for (const [x, y] of cells.values()) {
      const k = key(x, y);
      const kind: RoomKind = k === key(center, center) ? "start" : k === key(...bossCell) ? "boss" : k === key(...treasureCell) ? "treasure" : "normal";
      const doors = DIRS.filter(d => cells.has(key(x + STEP[d][0], y + STEP[d][1])));
      rooms.set(k, {
        gx: x, gy: y, kind, doors: Object.fromEntries(doors.map(d => [d, true])),
        tiles: makeTiles(kind, doors, rng), visited: false, seen: false, cleared: kind !== "normal" && kind !== "boss",
        distance: distance.get(k)!,
      });
    }
    return { rooms, start: rooms.get(key(center, center))!, boss: rooms.get(key(...bossCell))!, treasure: rooms.get(key(...treasureCell)) ?? null };
  }
  throw new Error("Could not generate a floor.");
}

/** Daily Crypt: ten rooms in a row, entered from the left. The last one is the boss. */
export const DAILY_ROOMS = 10;
export function generateLinear(rng: Rng): Floor {
  const rooms = new Map<string, Room>();
  let start: Room | null = null, boss: Room | null = null;
  for (let i = 0; i < DAILY_ROOMS; i++) {
    const kind: RoomKind = i === DAILY_ROOMS - 1 ? "boss" : "normal";
    const doors: Dir[] = [...(i > 0 ? ["left" as Dir] : []), ...(i < DAILY_ROOMS - 1 ? ["right" as Dir] : [])];
    const room: Room = { gx: i, gy: 0, kind, doors: Object.fromEntries(doors.map(d => [d, true])),
      tiles: makeTiles(kind, doors, rng), visited: false, seen: false, cleared: false, distance: i };
    rooms.set(key(i, 0), room);
    if (i === 0) start = room;
    if (kind === "boss") boss = room;
  }
  return { rooms, start: start!, boss: boss!, treasure: null };
}

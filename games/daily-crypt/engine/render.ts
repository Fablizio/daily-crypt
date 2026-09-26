/** Canvas renderer for rooms, Friends, shots and the HUD. Everything is drawn from code; no external art. */
import { COLS, ROWS, STEP, key, type Dir, type Room } from "./dungeon";
import { CX, CY, DOOR_POS, IN_H, IN_W, IN_X, IN_Y, TILE, VIEW_H, VIEW_W, WALL, type Enemy, type Game } from "./game";
import { drawFriend } from "./sprites";
import { FAMILY_NAMES, RELICS, THEMES, type Theme } from "./themes";

const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const bgCache = new WeakMap<Room, { canvas: HTMLCanvasElement; family: number }>();

function paintPattern(ctx: CanvasRenderingContext2D, theme: Theme, seed: number) {
  ctx.fillStyle = theme.floor; ctx.fillRect(IN_X, IN_Y, IN_W, IN_H);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const x = IN_X + tx * TILE, y = IN_Y + ty * TILE, r = hash(tx, ty, seed), r2 = hash(ty, tx, seed + 7);
    ctx.fillStyle = theme.floorDetail;
    switch (theme.pattern) {
      case "bones":
        if ((tx + ty) % 2) ctx.fillRect(x, y, TILE, TILE);
        if (r < 0.28) { ctx.fillStyle = "#efe8d2"; ctx.fillRect(x + 14, y + 26, 26, 5); ctx.fillRect(x + 11, y + 23, 6, 11); ctx.fillRect(x + 37, y + 23, 6, 11); }
        break;
      case "curtain":
        ctx.fillRect(x + (tx % 2 ? 0 : 28), y, 28, TILE);
        if (r < 0.12) { ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.25; ctx.fillRect(x + 20, y + 20, 16, 16); ctx.globalAlpha = 1; }
        break;
      case "planks":
        ctx.fillRect(x, y + 27, TILE, 2); ctx.fillRect(x + ((ty % 2) ? 20 : 44), y, 2, 27); ctx.fillRect(x + ((ty % 2) ? 8 : 32), y + 29, 2, 27);
        if (r < 0.1) { ctx.fillRect(x + 12, y + 10, 5, 5); }
        break;
      case "cells":
        if (r < 0.55) { ctx.beginPath(); ctx.arc(x + 10 + r2 * 36, y + 10 + r * 36, 6 + r2 * 10, 0, Math.PI * 2); ctx.strokeStyle = theme.floorDetail; ctx.lineWidth = 3; ctx.stroke(); }
        break;
      case "shards":
        ctx.beginPath(); ctx.moveTo(x + r * TILE, y); ctx.lineTo(x + r2 * TILE, y + TILE); ctx.lineWidth = 2; ctx.strokeStyle = theme.floorDetail; ctx.stroke();
        if ((tx * 3 + ty) % 5 === 0) ctx.fillRect(x + 6, y + 6, 18, 9);
        break;
      case "clouds":
        if (r < 0.35) { ctx.beginPath(); ctx.ellipse(x + 28, y + 30, 22 + r2 * 10, 10, 0, 0, Math.PI * 2); ctx.fill(); }
        break;
      case "slabs":
        if ((tx + ty * 2) % 3 === 0) ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        if (r < 0.2) { ctx.fillStyle = theme.wallDetail; ctx.fillRect(x + 10, y + 20, 22, 2); ctx.fillRect(x + 30, y + 20, 2, 14); }
        break;
      case "crystals":
        if ((tx + ty) % 2) ctx.fillRect(x, y, TILE, TILE);
        if (r < 0.2) { ctx.fillStyle = "#fff7c2"; ctx.fillRect(x + 26, y + 18, 4, 16); ctx.fillRect(x + 20, y + 24, 16, 4); }
        break;
      case "void":
        for (let i = 0; i < 3; i++) if (hash(tx, ty, seed + i) < 0.5) ctx.fillRect(x + hash(tx, i, seed) * 52, y + hash(i, ty, seed) * 52, 3, 3);
        break;
    }
  }
}

function paintObstacle(ctx: CanvasRenderingContext2D, theme: Theme, x: number, y: number, r: number) {
  const m = 6, s = TILE - m * 2;
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(x + m + 4, y + m + 8, s, s - 4);
  switch (theme.pattern) {
    case "bones":
      ctx.fillStyle = theme.wall; ctx.fillRect(x + m, y + m + 6, s, s - 6);
      ctx.fillStyle = "#efe8d2"; ctx.fillRect(x + 14, y + 10, 28, 22); ctx.fillStyle = theme.wall; ctx.fillRect(x + 19, y + 17, 6, 6); ctx.fillRect(x + 31, y + 17, 6, 6);
      ctx.fillStyle = "#efe8d2"; ctx.fillRect(x + 18, y + 32, 20, 6); break;
    case "curtain":
      ctx.fillStyle = theme.wallDetail; ctx.fillRect(x + m, y + m, s, s);
      ctx.fillStyle = "#f5e6ee"; ctx.fillRect(x + 14, y + 14, 28, 22); ctx.fillStyle = "#000"; ctx.fillRect(x + 19, y + 20, 6, 4); ctx.fillRect(x + 31, y + 20, 6, 4); ctx.fillRect(x + 23, y + 29, 10, 3); break;
    case "planks":
      ctx.fillStyle = theme.wallDetail; ctx.fillRect(x + m, y + m, s, s); ctx.strokeStyle = theme.wall; ctx.lineWidth = 4;
      ctx.strokeRect(x + m + 2, y + m + 2, s - 4, s - 4); ctx.beginPath(); ctx.moveTo(x + m + 2, y + m + 2); ctx.lineTo(x + TILE - m - 2, y + TILE - m - 2); ctx.stroke(); break;
    case "cells":
      ctx.fillStyle = theme.wall; ctx.fillRect(x + 12, y + m, s - 12, s); ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.6; ctx.fillRect(x + 16, y + 22, s - 20, s - 20); ctx.globalAlpha = 1;
      ctx.fillStyle = "#e6fff2"; ctx.fillRect(x + 18, y + 12, 4, 10); break;
    case "shards":
      ctx.fillStyle = theme.wallDetail; ctx.beginPath(); ctx.moveTo(x + m + 10, y + m); ctx.lineTo(x + TILE - m, y + m + 6); ctx.lineTo(x + TILE - m - 8, y + TILE - m); ctx.lineTo(x + m, y + TILE - m - 10); ctx.fill();
      ctx.fillStyle = theme.wall; ctx.fillRect(x + 22, y + 18, 10, 16); break;
    case "clouds":
      ctx.fillStyle = theme.wallDetail; ctx.beginPath(); ctx.arc(x + 20, y + 30, 14, 0, Math.PI * 2); ctx.arc(x + 34, y + 24, 16, 0, Math.PI * 2); ctx.arc(x + 38, y + 36, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.accent; ctx.fillRect(x + 26, y + 40, 4, 10); ctx.fillRect(x + 22, y + 48, 4, 4); break;
    case "slabs":
      ctx.fillStyle = theme.wallDetail; ctx.beginPath(); ctx.arc(x + 28, y + 30, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.wall; ctx.fillRect(x + 16, y + 30, 14, 3); ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + 18, y + 14, 10, 6); break;
    case "crystals":
      ctx.fillStyle = theme.wallDetail; ctx.fillRect(x + m, y + 36, s, 14);
      ctx.fillStyle = r < 0.5 ? theme.accent : "#fff3a6"; ctx.beginPath(); ctx.moveTo(x + 28, y + 4); ctx.lineTo(x + 42, y + 36); ctx.lineTo(x + 28, y + 46); ctx.lineTo(x + 14, y + 36); ctx.fill(); break;
    case "void":
      ctx.fillStyle = "#050507"; ctx.beginPath(); ctx.ellipse(x + 28, y + 30, 22, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x + 28, y + 30, 14, 10, r * 3, 0, Math.PI * 1.4); ctx.stroke(); break;
  }
}

function paintWalls(ctx: CanvasRenderingContext2D, theme: Theme, seed: number) {
  ctx.fillStyle = theme.wall;
  ctx.fillRect(IN_X - WALL, IN_Y - WALL, IN_W + WALL * 2, IN_H + WALL * 2);
  ctx.fillStyle = theme.wallDetail;
  for (let i = 0; i < 70; i++) {
    const side = i % 4, t = hash(i, seed, 3);
    const w = 16 + hash(seed, i, 1) * 26;
    if (side === 0) ctx.fillRect(IN_X - WALL + t * (IN_W + WALL * 2 - w), IN_Y - WALL + 6 + (i % 3) * 10, w, 6);
    if (side === 1) ctx.fillRect(IN_X - WALL + t * (IN_W + WALL * 2 - w), IN_Y + IN_H + 8 + (i % 3) * 10, w, 6);
    if (side === 2) ctx.fillRect(IN_X - WALL + 6 + (i % 3) * 10, IN_Y + t * (IN_H - w), 6, w);
    if (side === 3) ctx.fillRect(IN_X + IN_W + 8 + (i % 3) * 10, IN_Y + t * (IN_H - w), 6, w);
  }
  // Inner lip and a soft shadow on the floor.
  ctx.fillStyle = "#000"; ctx.globalAlpha = 0.5;
  ctx.fillRect(IN_X - 4, IN_Y - 4, IN_W + 8, 4); ctx.fillRect(IN_X - 4, IN_Y + IN_H, IN_W + 8, 4);
  ctx.fillRect(IN_X - 4, IN_Y, 4, IN_H); ctx.fillRect(IN_X + IN_W, IN_Y, 4, IN_H);
  ctx.globalAlpha = 0.16; ctx.fillRect(IN_X, IN_Y, IN_W, 14); ctx.fillRect(IN_X, IN_Y, 10, IN_H);
  ctx.globalAlpha = 1;
}

function roomBackground(game: Game, room: Room) {
  const family = game.cast.family;
  const cached = bgCache.get(room);
  if (cached && cached.family === family) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = VIEW_W; canvas.height = VIEW_H;
  const ctx = canvas.getContext("2d")!;
  const theme = THEMES[family], seed = room.gx * 31 + room.gy * 17 + 7;
  paintWalls(ctx, theme, seed);
  paintPattern(ctx, theme, seed);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const tile = room.tiles[ty][tx], x = IN_X + tx * TILE, y = IN_Y + ty * TILE;
    if (tile === 2) {
      ctx.fillStyle = "#050505"; ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = theme.wall; ctx.fillRect(x + 2, y + 2, TILE - 4, 6);
    } else if (tile === 1) paintObstacle(ctx, theme, x, y, hash(tx, ty, seed));
  }
  bgCache.set(room, { canvas, family });
  return canvas;
}

function paintDoor(ctx: CanvasRenderingContext2D, game: Game, d: Dir, open: boolean, target: Room | undefined) {
  const theme = game.theme, [x, y] = DOOR_POS[d];
  const horizontal = d === "up" || d === "down";
  const w = horizontal ? TILE - 4 : WALL + 6, h = horizontal ? WALL + 6 : TILE - 4;
  const left = horizontal ? x - w / 2 : d === "left" ? x - WALL - 6 : x;
  const top = horizontal ? (d === "up" ? y - WALL - 6 : y) : y - h / 2;
  const frame = target?.kind === "boss" ? "#b3122e" : target?.kind === "treasure" ? "#ffd23f" : theme.accent;
  ctx.fillStyle = frame; ctx.fillRect(left - 6, top - 6, w + 12, h + 12);
  ctx.fillStyle = "#050505"; ctx.fillRect(left, top, w, h);
  if (!open) {
    ctx.fillStyle = theme.wallDetail;
    if (horizontal) for (let i = 0; i < 4; i++) ctx.fillRect(left + 6 + i * 12, top, 5, h);
    else for (let i = 0; i < 4; i++) ctx.fillRect(left, top + 6 + i * 12, w, 5);
  }
  if (target?.kind === "boss") { ctx.fillStyle = "#fff"; const cx = left + w / 2, cy = top + h / 2; ctx.fillRect(cx - 7, cy - 7, 14, 10); ctx.fillStyle = "#b3122e"; ctx.fillRect(cx - 4, cy - 4, 3, 3); ctx.fillRect(cx + 1, cy - 4, 3, 3); }
}

function paintHeart(ctx: CanvasRenderingContext2D, x: number, y: number, fill: 0 | 1 | 2, s = 3) {
  const rows = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
  rows.forEach((row, ry) => [...row].forEach((c, rx) => {
    if (c !== "X") return;
    const filled = fill === 2 || (fill === 1 && rx < 4);
    ctx.fillStyle = filled ? "#ff3b4e" : "#3b2327";
    ctx.fillRect(x + rx * s, y + ry * s, s, s);
  }));
}

/** The crypt is a straight line: ten cells, the current one lit, the boss at the end. */
function paintMinimap(ctx: CanvasRenderingContext2D, game: Game) {
  const n = game.floors, cw = 13, ch = 12, ox = VIEW_W - 14 - n * cw, oy = 10;
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(ox - 4, oy - 4, n * cw + 6, ch + 8);
  for (let i = 0; i < n; i++) {
    const x = ox + i * cw;
    ctx.fillStyle = i === game.roomIndex ? "#ffffff" : i < game.roomIndex ? "#8a8a8a" : "#333333";
    ctx.fillRect(x, oy, cw - 3, ch);
    if (i === n - 1) { ctx.fillStyle = "#e0243f"; ctx.fillRect(x + 3, oy + 4, 4, 4); }
    if (i === 4) { ctx.fillStyle = "#ccff00"; ctx.fillRect(x + 3, oy + 4, 4, 4); }
  }
  ctx.fillStyle = "#bdbdbd"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "right";
  ctx.fillText(`ROOM ${game.roomIndex + 1}/${n}`, VIEW_W - 12, oy + ch + 20);
}

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function paintShield(ctx: CanvasRenderingContext2D, x: number, y: number, full: boolean) {
  const rows = ["XXXXX", "XXXXX", "XXXXX", ".XXX.", "..X.."];
  rows.forEach((row, ry) => [...row].forEach((c, rx) => {
    if (c !== "X") return;
    ctx.fillStyle = full ? "#ccff00" : "#2c3314";
    ctx.fillRect(x + rx * 4, y + ry * 4, 4, 4);
  }));
}

function paintEnemy(ctx: CanvasRenderingContext2D, game: Game, e: Enemy, frame: number) {
  const theme = game.theme;
  const halo = e.flash > 0 ? "#ffffff" : e.elite ? "#ffffff" : theme.accent;
  const ink = e.flash > 0 ? theme.accent : "#000000";
  let alpha = e.alpha;
  if (e.spawn > 0) alpha *= 1 - e.spawn / 0.5;
  const shadowW = e.r * 1.1;
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, shadowW, shadowW * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  if (e.elite && alpha > 0.5) { ctx.strokeStyle = theme.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, shadowW + 6, shadowW * 0.35 + 3, 0, 0, Math.PI * 2); ctx.stroke(); }
  let x = e.x, y = e.y - e.lift;
  if ((e.state === "windup" || e.state === "charge-windup") && !game.reducedMotion) x += Math.sin(game.time * 60) * 2;
  if (alpha <= 0.02) return;
  drawFriend(ctx, e.sprites, x, y + 2, { facing: e.facing, side: e.side, walking: e.moving, frame }, e.scale, ink, halo, alpha);
}

export function render(ctx: CanvasRenderingContext2D, game: Game, now: number) {
  const theme = game.theme, room = game.room, state = game.state, p = game.player;
  const frame = game.reducedMotion ? 0 : Math.floor(now / 110) % 8;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#070708"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const shake = game.shake > 0 && !game.reducedMotion ? 5 * game.shake / 0.3 : 0;
  ctx.save();
  if (shake) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
  ctx.drawImage(roomBackground(game, room), 0, 0);
  for (const d of Object.keys(room.doors) as Dir[]) {
    const target = game.floor.rooms.get(key(room.gx + STEP[d][0], room.gy + STEP[d][1]));
    paintDoor(ctx, game, d, room.cleared, target);
  }
  // Trapdoor / exit light.
  if (state.trapdoor) {
    const last = game.depth + 1 >= game.floors;
    ctx.fillStyle = last ? "#fffbe0" : "#000"; ctx.fillRect(CX - 30, CY - 22, 60, 44);
    ctx.strokeStyle = last ? "#ffe45c" : theme.accent; ctx.lineWidth = 4; ctx.strokeRect(CX - 30, CY - 22, 60, 44);
    if (!last) { ctx.fillStyle = theme.wallDetail; for (let i = 0; i < 3; i++) ctx.fillRect(CX - 22, CY - 14 + i * 12, 44, 4); }
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillText(last ? "ESCAPE" : "DESCEND", CX, CY + 40);
  }
  if (state.pedestal) {
    const ped = state.pedestal;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(ped.x - 22, ped.y + 4, 44, 10);
    ctx.fillStyle = theme.wallDetail; ctx.fillRect(ped.x - 20, ped.y - 16, 40, 24);
    ctx.fillStyle = theme.wall; ctx.fillRect(ped.x - 24, ped.y - 20, 48, 8);
    if (!ped.taken) {
      const bob = game.reducedMotion ? 0 : Math.sin(now / 300) * 4, gy = ped.y - 46 + bob;
      ctx.fillStyle = ped.relic === "heart" ? "#ff3b4e" : "#ccff00";
      ctx.beginPath(); ctx.moveTo(ped.x, gy - 16); ctx.lineTo(ped.x + 14, gy); ctx.lineTo(ped.x, gy + 16); ctx.lineTo(ped.x - 14, gy); ctx.fill();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.stroke();
      const label = ped.relic === "heart" ? "Heart container" : RELICS.find(r => r.id === ped.relic)!.name;
      ctx.fillStyle = "#000"; ctx.font = "bold 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText(label, ped.x, ped.y + 30);
    }
  }
  for (const item of state.pickups) {
    const bob = game.reducedMotion ? 0 : Math.sin(now / 200 + item.x) * 2;
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(item.x, item.y + 8, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (item.kind === "spark") {
      ctx.fillStyle = "#000"; ctx.fillRect(item.x - 8, item.y - 10 + bob, 16, 16);
      ctx.fillStyle = "#ccff00"; ctx.fillRect(item.x - 6, item.y - 8 + bob, 12, 12); ctx.fillStyle = "#000"; ctx.fillRect(item.x - 2, item.y - 4 + bob, 4, 4);
    } else paintHeart(ctx, item.x - 10, item.y - 14 + bob, item.kind === "heart" ? 2 : 1, 3);
  }
  // Depth-sorted actors.
  type Layer = { y: number; draw: () => void };
  const layers: Layer[] = [];
  for (const e of state.enemies) layers.push({ y: e.y, draw: () => paintEnemy(ctx, game, e, frame) });
  const flicker = p.invuln > 0 && game.status === "playing" && Math.floor(now / 80) % 2 === 0;
  layers.push({ y: p.y, draw: () => {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    const lift = game.stats.flying ? 6 + (game.reducedMotion ? 0 : Math.sin(now / 250) * 2) : 0;
    drawFriend(ctx, game.playerSprites, p.x, p.y + 2 - lift, { facing: p.facing, side: p.side, walking: p.moving, frame }, 4, "#000000", "#ffffff",
      flicker && !game.reducedMotion ? 0.35 : 1);
  } });
  for (const familiar of game.familiars) layers.push({ y: familiar.y, draw: () =>
    drawFriend(ctx, game.playerSprites, familiar.x, familiar.y, { facing: p.facing, side: p.side, walking: p.moving, frame }, 2, "#000000", "#ccff00") });
  layers.sort((a, b) => a.y - b.y).forEach(layer => layer.draw());
  for (const tear of game.tears) {
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(tear.x, tear.y + 18, tear.r * 0.8, tear.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(tear.x, tear.y, tear.r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tear.friendly ? (game.stats.homing ? "#ccff00" : "#ffffff") : theme.accent;
    ctx.beginPath(); ctx.arc(tear.x, tear.y, tear.r, 0, Math.PI * 2); ctx.fill();
  }
  for (const particle of game.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.max); ctx.fillStyle = particle.color;
    ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 14px ui-monospace, monospace"; ctx.textAlign = "center";
  for (const text of game.texts) {
    ctx.globalAlpha = Math.min(1, text.life * 2);
    ctx.fillStyle = "#000"; ctx.fillText(text.text, text.x + 1, text.y + 1);
    ctx.fillStyle = text.color; ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  paintHud(ctx, game);
  if (game.fade > 0 && !game.reducedMotion) { ctx.fillStyle = `rgba(0,0,0,${game.fade})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
}

function paintHud(ctx: CanvasRenderingContext2D, game: Game) {
  const theme = game.theme, left = game.guard - game.hits;
  // Guard: hits you can still take. The last one ends the run.
  for (let i = 0; i < game.guard; i++) paintShield(ctx, 14 + i * 24, 10, i < left);
  ctx.textAlign = "left"; ctx.font = "bold 20px ui-monospace, monospace"; ctx.fillStyle = "#ffffff";
  ctx.fillText(formatClock(game.finalTime), 14, 56);
  if (game.hits) { ctx.font = "12px ui-monospace, monospace"; ctx.fillStyle = "#ff6b7d"; ctx.fillText(`incl. +${game.hits * 5}s`, 142, 56); }
  ctx.textAlign = "center";
  ctx.fillStyle = theme.accent; ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillText(`${game.practice ? "PRACTICE · " : ""}${theme.floorName.toUpperCase()}`, VIEW_W / 2, 26);
  ctx.fillStyle = "#9a9a9a"; ctx.font = "12px ui-monospace, monospace";
  const boss = game.boss;
  if (boss) { ctx.fillStyle = "#ff6b7d"; ctx.font = "bold 13px ui-monospace, monospace"; }
  ctx.fillText(boss ? `BOSS · Friend #${boss.sprites.tokenId} · ${boss.sprites.familyName}`
    : `${FAMILY_NAMES[game.cast.family]} · ${game.state.enemies.length ? `${game.state.enemies.length} Friends hostile` : "room clear, go right"}`, VIEW_W / 2, 46);
  paintMinimap(ctx, game);
  // Relics collected.
  const bottom = IN_Y + IN_H + WALL + 30;
  ctx.textAlign = "center"; ctx.font = "12px ui-monospace, monospace"; ctx.fillStyle = "#bdbdbd";
  const relicNames = game.relics.map(id => RELICS.find(r => r.id === id)!.name);
  ctx.fillText(`${game.perk.name}${relicNames.length ? " · " + relicNames.join(" · ") : ""}`, VIEW_W / 2, bottom, 520);
  if (boss) {
    const w = 420, x = (VIEW_W - w) / 2, y = bottom + 10;
    ctx.fillStyle = "#000"; ctx.fillRect(x - 3, y - 3, w + 6, 16);
    ctx.fillStyle = "#3a0d15"; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = "#e0243f"; ctx.fillRect(x, y, w * Math.max(0, boss.hp / boss.maxHp), 10);
  }
}

/** Canonical 16×16 Friend masks, pre-rendered at integer scale with a one-pixel halo. */
import { spriteFrame, type GenerationSprites, type SpriteFacing, type SpriteFrame } from "@rarefriends/friendsdk/sprites";

const cache = new Map<string, HTMLCanvasElement>();

export function frameCanvas(frame: SpriteFrame, scale: number, ink: string, halo: string) {
  const key = `${frame.bitmap.toString(16)}|${scale}|${ink}|${halo}`;
  let canvas = cache.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas");
  canvas.width = 18 * scale; canvas.height = 18 * scale;
  const ctx = canvas.getContext("2d")!;
  const rows = frame.rows;
  ctx.fillStyle = halo;
  rows.forEach((row, y) => { for (let x = 0; x < 16; x++) if (row[x] === "#") ctx.fillRect(x * scale, y * scale, scale * 3, scale * 3); });
  ctx.fillStyle = ink;
  rows.forEach((row, y) => { for (let x = 0; x < 16; x++) if (row[x] === "#") ctx.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale); });
  if (cache.size > 900) cache.delete(cache.keys().next().value!);
  cache.set(key, canvas);
  return canvas;
}

/** The lowest opaque row of a frame, so sprites stand on their feet rather than on empty rows. */
const footCache = new Map<bigint, number>();
export function footRow(frame: SpriteFrame) {
  let value = footCache.get(frame.bitmap);
  if (value !== undefined) return value;
  value = 15;
  while (value > 0 && !frame.rows[value].includes("#")) value--;
  footCache.set(frame.bitmap, value);
  return value;
}

export type Pose = { facing: SpriteFacing; side: "left" | "right"; walking: boolean; frame: number };

/** Draw a Friend with its feet at (x, y). */
export function drawFriend(
  ctx: CanvasRenderingContext2D, sprites: GenerationSprites, x: number, y: number, pose: Pose,
  scale: number, ink: string, halo: string, alpha = 1,
) {
  const frame = spriteFrame(sprites, pose.facing, pose.walking, pose.frame & 7, pose.side).frame;
  const canvas = frameCanvas(frame, scale, ink, halo);
  const foot = footRow(frame);
  const left = Math.round(x - 9 * scale), top = Math.round(y - (foot + 2) * scale);
  if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(canvas, left, top); ctx.restore(); }
  else ctx.drawImage(canvas, left, top);
}

export function facingFrom(dx: number, dy: number): SpriteFacing {
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
}

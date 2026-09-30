// Automated browser check for Daily Crypt (test fixtures only: mock wallet, mock RPC, sample art).
// Run from the SDK root: node games/daily-crypt/tests/browser.mjs [outdir]
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { buildGame, createGameServer } from "../../../scripts/dev-game.mjs";
import { installFixture } from "../../../scripts/browser-fixture.mjs";
import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST } from "../../../dist/generation-sprites.js";

const MULTICALL = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const source = await readFile(new URL("../../../examples/fishing/sample-sprites.ts", import.meta.url), "utf8");
const sample = id => [...source.split(`"${id}": decodeGenerationSprites`)[1].split("]),")[0].matchAll(/0x[0-9a-f]+n/g)].map(([w]) => BigInt(w.slice(0, -1)));
const FRAMES = [sample(7730), sample(3412)];

function registry(data) {
  const { functionName, args } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data });
  let result;
  if (functionName === "familyOf") result = args[0] === 7730n ? 5 : Number(args[0] % 9n);
  else if (functionName === "seedOf") result = Number(args[0] % 4294967296n);
  else if (functionName === "frames") result = FRAMES[args[1] % 2];
  else throw new Error(`Unexpected artwork read ${functionName}`);
  return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName, result });
}
const reads = { multicall: 0, registry: 0 };
function artworkCall(call) {
  const to = call.to.toLowerCase();
  if (to === GENERATION_SPRITE_MANIFEST.registry.toLowerCase()) { reads.registry++; return registry(call.data); }
  if (to === "0xca11bde05977b3631167028862be2a173976ca11") {
    reads.multicall++;
    const { args } = decodeFunctionData({ abi: MULTICALL, data: call.data });
    const out = args[0].map(c => {
      assert.equal(c.target.toLowerCase(), GENERATION_SPRITE_MANIFEST.registry.toLowerCase(), "Only the artwork registry is read");
      return { success: true, returnData: registry(c.callData) };
    });
    return encodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", result: out });
  }
  throw new Error(`Unexpected contract ${call.to}`);
}

const outdir = resolve(process.argv[2] ?? "games/daily-crypt/.artifacts");
await mkdir(outdir, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "bor-test-"));
const build = await buildGame(resolve("games/daily-crypt"), { outdir: join(temporary, "dist") });
const server = createGameServer(build.outdir);
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const failures = [];
try {
  for (const view of [{ name: "desktop", width: 960, height: 800, touch: false }, { name: "phone-landscape", width: 844, height: 390, touch: true }, { name: "phone-portrait", width: 390, height: 844, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, hasTouch: view.touch, isMobile: view.touch });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    const fixture = await installFixture(page, origin, { artworkCall });
    await page.goto(origin);
    await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    const game = page.frameLocator("iframe");
    await game.getByRole("button", { name: /Practice \(free\)/ }).waitFor({ timeout: 20000 });
    // The fixture reports the sample Friend as Gen 1: prestige badge in the lobby (read in the background).
    await game.getByText("GEN 1 · LEGENDARY").waitFor({ timeout: 10000 });
    await page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-title.png`) });
    await page.screenshot({ path: join(outdir, `${view.name}-page.png`) });
    await game.getByRole("button", { name: /^Ranked run/ }).click();
    await page.waitForTimeout(200);
    await page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-confirm.png`) });
    await game.getByRole("button", { name: /^Enter · / }).click();
    await game.locator("canvas").waitFor();
    const frameHandle = page.frames().find(f => f !== page.mainFrame());
    await page.waitForTimeout(600);
    await page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-start.png`) });
    // Walk up through the start room's door using keys, shoot a bit.
    const canvas = game.locator("canvas");
    await canvas.focus();
    if (!view.touch) {
      await page.keyboard.down("ArrowUp"); await page.waitForTimeout(400); await page.keyboard.up("ArrowUp");
      for (const k of ["w", "d", "s", "a"]) { await page.keyboard.down(k); await page.waitForTimeout(250); await page.keyboard.up(k); }
    } else {
      const box = await canvas.boundingBox();
      await canvas.tap({ position: { x: box.width * 0.25, y: box.height * 0.5 } });
    }
    // Drive the game through test-only engine access: move the player into rooms to see enemies.
    await frameHandle.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-play.png`) });
    await page.waitForTimeout(200);
    if (view.name === "desktop") {
      // Stand still until the guard breaks, buy the continue, die again, then check share, halo shop and ghost race.
      const shot = name => page.locator(".rf-game-frame").screenshot({ path: join(outdir, `${view.name}-${name}.png`) });
      await game.getByRole("alertdialog").waitFor({ timeout: 150000 });
      await shot("revive");
      await game.getByRole("button", { name: /^Continue · 5 RF/ }).click();
      await game.getByText("BOUND").waitFor({ timeout: 150000 });
      const share = await game.getByRole("textbox", { name: /Result text/ }).inputValue();
      assert.match(share, /^Daily Crypt \d{4}-\d{2}-\d{2} · Friend #7730 \(Gen 1\) · fell in room \d+\/10 · 1 continue · ranked attempt · https:\/\/fablizio\.github\.io\/daily-crypt\/$/);
      assert.ok(await game.getByText(/Used 1 continue/).isVisible(), "continue noted on the result");
      assert.ok(await game.getByText("GEN 1 · LEGENDARY").isVisible(), "generation badge on the result");
      await game.getByRole("button", { name: "Copy result" }).click();
      await game.getByText(/Copied ✓|Copy blocked here/).waitFor();
      console.log("share:", share, "·", await game.getByText(/Copied ✓|Copy blocked here/).innerText());
      await shot("result");
      await game.getByRole("button", { name: "Lobby" }).click();
      // Balance: 100 - 10 entry - 5 continue.
      assert.ok(await game.getByText(/Balance 85 RF/).isVisible(), "entry and continue debited");
      await game.getByRole("button", { name: /Ember halo, buy for 20 RF/ }).click();
      await game.getByRole("button", { name: "Buy · 20 RF" }).click();
      assert.ok(await game.getByRole("button", { name: /Ember halo, equipped/ }).isVisible(), "halo equipped");
      assert.ok(await game.getByText(/halos 20 RF/).isVisible(), "halo burn counted");
      // Gen 1-2 get the Legendary halo free: equipping it costs nothing and burns nothing.
      await game.getByRole("button", { name: /Legendary halo, Gen 1–2 only, free, equip/ }).click();
      assert.ok(await game.getByRole("button", { name: /Legendary halo, Gen 1–2 only, equipped/ }).isVisible(), "Legendary halo equipped");
      assert.ok(await game.getByText(/halos 20 RF/).isVisible(), "Legendary halo burns nothing");
      assert.ok(await game.getByText(/Balance 65 RF/).first().isVisible(), "Legendary halo is free");
      await game.getByRole("button", { name: "100", exact: true }).click();
      assert.ok(await game.getByText(/365 RF burned\/day/).isVisible(), "projection at 100 attempts/day");
      await shot("lobby-after");
      await game.getByRole("button", { name: /^Race ghost/ }).click();
      await page.waitForTimeout(2500);
      await shot("ghost");
      await page.keyboard.press("p");
      await game.getByRole("button", { name: "Quit" }).click();
      await game.getByRole("button", { name: /Practice \(free\)/ }).waitFor();
    }
    assert.deepEqual([...new Set([...errors, ...fixture.errors])], [], `${view.name}: browser errors`);
    await context.close();
  }
  console.log("reads", reads);
} catch (e) { failures.push(e); console.error(e); }
finally { await browser.close(); server.closeAllConnections(); server.close(); await build.close(); await rm(temporary, { recursive: true, force: true }); }
if (failures.length) process.exit(1);
console.log("ok, screenshots in", outdir);

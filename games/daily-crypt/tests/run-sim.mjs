import { build } from "esbuild";
import { resolve } from "node:path";
const out = resolve("games/daily-crypt/.artifacts/sim.mjs");
await build({ entryPoints: ["games/daily-crypt/tests/sim.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { run } = await import(out);
const results = { god: [], normal: [] };
let n = 0;
for (let family = 0; family < 9; family++) for (const god of [true, false]) {
  const others = [0,1,2,3,4,5,6,7,8].filter(f => f !== family);
  for (let s = 0; s < 3; s++) {
    const seed = 1000 + n++;
    const fams = [family, others[(s * 3) % 8], others[(s * 3 + 1) % 8], others[(s * 3 + 2) % 8]];
    const r = run(seed, family, fams, god);
    (god ? results.god : results.normal).push(r);
    if (r.log.some(l => l.startsWith("STUCK")) || (god && r.status !== "won") || r.verified === false) console.log("PROBLEM", { family, god, seed, fams, status: r.status, room: r.room, verified: r.verified, t: r.time.toFixed(1), last: r.log.slice(-2) });
  }
}
const summarize = list => ({ runs: list.length, won: list.filter(r => r.status === "won").length, dead: list.filter(r => r.status === "dead").length,
  avgRoom: (list.reduce((a, r) => a + r.room, 0) / list.length).toFixed(2), avgHits: (list.reduce((a, r) => a + r.hits, 0) / list.length).toFixed(1),
  wonTimes: list.filter(r => r.status === "won").map(r => r.time.toFixed(0)).join(","), verified: list.filter(r => r.verified).length + "/" + list.filter(r => r.verified !== null).length });
console.log("invulnerable bot:", summarize(results.god));
console.log("normal bot:", summarize(results.normal));

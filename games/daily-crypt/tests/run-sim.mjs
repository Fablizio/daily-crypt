import { build } from "esbuild";
import { resolve } from "node:path";
const out = resolve("games/daily-crypt/.artifacts/sim.mjs");
await build({ entryPoints: ["games/daily-crypt/tests/sim.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const { run, verify } = await import(out);
const results = { god: [], normal: [] };
let n = 0, problems = 0;
for (let family = 0; family < 9; family++) for (const god of [true, false]) {
  const others = [0,1,2,3,4,5,6,7,8].filter(f => f !== family);
  for (let s = 0; s < 3; s++) {
    const seed = 1000 + n++;
    const fams = [family, others[(s * 3) % 8], others[(s * 3 + 1) % 8], others[(s * 3 + 2) % 8]];
    // Honest runs: two out of three buy the paid continue when their guard breaks, one declines it.
    const r = run(seed, family, fams, god, undefined, { revive: !god && s !== 0 });
    (god ? results.god : results.normal).push(r);
    // A stuck bot (its aim caught behind rocks) is a bot limitation, reported but not a failure; a replay mismatch is.
    if (r.verified === false) problems++;
    if (r.log.some(l => l.startsWith("STUCK")) || (god && r.status !== "won") || r.verified === false)
      console.log(`${r.verified === false ? "PROBLEM" : "note"}: family ${family} ${god ? "god" : "normal"} seed ${seed} ${r.status} room ${r.room} verified=${r.verified} · ${r.log.at(-1)?.slice(0, 40)}`);
  }
}
const summarize = list => ({ runs: list.length, won: list.filter(r => r.status === "won").length, dead: list.filter(r => r.status === "dead").length,
  avgRoom: (list.reduce((a, r) => a + r.room, 0) / list.length).toFixed(2), avgHits: (list.reduce((a, r) => a + r.hits, 0) / list.length).toFixed(1),
  revived: list.filter(r => r.revives > 0).length,
  wonTimes: list.filter(r => r.status === "won").map(r => r.time.toFixed(0)).join(","), verified: list.filter(r => r.verified).length + "/" + list.filter(r => r.verified !== null).length });
console.log("invulnerable bot:", JSON.stringify(summarize(results.god)));
console.log("normal bot:", JSON.stringify(summarize(results.normal)));

// Tampering with the continue log must be caught by verify().
const withRevive = results.normal.filter(r => r.revives > 0);
let caught = 0, tampers = 0;
for (const r of withRevive) {
  const cases = [
    { ...r.record, revives: [] },                                             // hide a continue that was used
    { ...r.record, revives: [r.record.revives[0] + 1] },                     // claim it at another tick
    { ...r.record, revives: [...r.record.revives, r.record.revives[0]] },    // claim a second continue
    { ...r.record, claimed: { ...r.record.claimed, revives: 0 } },           // lie about the count
  ];
  for (const record of cases) { tampers++; if (!verify(record, r.sprites, r.roster).ok) caught++; }
}
console.log(`continue tampering: ${caught}/${tampers} rejected across ${withRevive.length} revived runs`);
if (caught !== tampers) problems++;

// Ghost: a second Game replaying a recorded run in lockstep must match that run exactly and must not change the live run.
let ghostOk = 0, liveOk = 0, haloOk = 0;
const sample = results.normal.slice(0, 9);
for (const [i, r] of sample.entries()) {
  const fams = r.roster.floors.map(f => f.family);
  const live = run(r.record.seed, r.record.family, fams, false, undefined, { revive: false, ghost: r.record });
  const plain = run(r.record.seed, r.record.family, fams, false, undefined, { revive: false });
  const g = live.ghost, c = r.record.claimed;
  // The ghost stops when the live run stops, so compare up to the shorter of the two.
  const ghostDone = g.ticks === c.ticks && g.status === c.status && g.hits === c.hits && g.revives === c.revives;
  const ghostPartial = live.ticks < c.ticks && g.ticks === live.ticks;
  if (ghostDone || ghostPartial) ghostOk++;
  if (live.ticks === plain.ticks && live.hits === plain.hits && live.status === plain.status) liveOk++;
  const tinted = run(r.record.seed, r.record.family, fams, false, undefined, { revive: i % 2 === 1, halo: "#ff7a3d" });
  const untinted = run(r.record.seed, r.record.family, fams, false, undefined, { revive: i % 2 === 1 });
  if (tinted.ticks === untinted.ticks && tinted.hits === untinted.hits && tinted.status === untinted.status && tinted.record.frames.every((v, k) => v === untinted.record.frames[k])) haloOk++;
}
console.log(`ghost lockstep: ${ghostOk}/${sample.length} ghosts track their record · live run unchanged by ghost ${liveOk}/${sample.length} · halo has no sim effect ${haloOk}/${sample.length}`);
if (ghostOk !== sample.length || liveOk !== sample.length || haloOk !== sample.length) problems++;
if (problems) { console.log(`${problems} problem(s)`); process.exitCode = 1; }

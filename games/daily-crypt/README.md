# Daily Crypt

Builder: Fablizio · [GitHub @Fablizio](https://github.com/Fablizio) · [X @FabrizioCottone](https://x.com/FabrizioCottone) · [Telegram @Fablizio](https://t.me/Fablizio) · FriendSDK **v0.1.2** · Rare Friends Vibeathon (**Token Activity**)

A daily time-attack dungeon, the same for everyone. Every ranked attempt costs $RAREFRIENDS: 20% is burned and
80% goes into the day's prize pool, which pays the three fastest verified runs. Your verified Generations Friend
is the runner, and every enemy and boss is a real Rare Friend. **All RF, balances, entries, the pool, the burn
and rival times are simulated in this prototype.** See [ECONOMY.md](ECONOMY.md) for the full economic design.

## Run it

From the repository root (Node.js 22+):

```sh
npm ci
npm run build
npm run dev:game -- games/daily-crypt
```

Open `http://localhost:4173`, connect a wallet on **Robinhood mainnet (4663)** holding a hardwired Generations
Friend (generation ≥ 1) and select it. The SDK runtime handles connection, selection and the fresh ownership
check. No transaction or signature is requested. Static build: `npx friendsdk build games/daily-crypt`.

## Controls

| | Keyboard / mouse | Touch (landscape) |
| --- | --- | --- |
| Move | WASD | Left thumb, anywhere on the left half |
| Shoot | Arrow keys, or hold the left mouse button | Right thumb, anywhere on the right half |
| Power-up choice | 1 / 2 / 3, or click | Tap a card |
| Pause / mute | P or Esc / M, or the on-screen buttons | On-screen buttons |

Settings and pause include **Mute** and **Reduce motion**. The run and its clock pause on blur, hidden tabs, the
pause menu and whenever the runtime opens its own menus.

## Rules

- **One crypt per UTC day, identical for everyone.** It has 10 rooms in a straight line. The rooms, the real Friends in them,
  their spawn points, elites and the power-up offer all come from the day's seed. It resets at 00:00 UTC.
- The route is linear on purpose: with a shared seed, a branching map would reward scouting instead of play.
- Doors open only when the room is empty. Rooms get harder (6 → 14 Friends, elites from room 5, two families mixed
  from room 7).
- **After room 5**, choose 1 of 3 power-ups (the same three for everyone that day). The clock stops while you choose.
- **Room 10 is the boss**: a real Friend at 6× size with four attacks, faster below half health. The clock stops
  when it falls.
- **No healing.** Every hit adds **+5 s**. You have **6 guard** (7 for Colossus Friends). The last hit ends the run.
- **Score = clear time + 5 s × hits.** Lowest wins.
- Your Friend's family perk applies (piercing, twin shots, familiar, split shots, wobble, flight, heavy shots,
  bursts, phase skin). The leaderboard shows the family.

## Economy (simulated)

| | |
| --- | --- |
| Ranked entry | **10 RF** per attempt, unlimited attempts |
| Burned | **20%** of every entry (2 RF) |
| Day pool | **80%** of every entry (8 RF) |
| Payout at 00:00 UTC | **50% / 30% / 20%** to the three fastest *verified* times |
| Practice | Free, same crypt, never ranked |
| Starting balance | 100 RF, simulated, per session |

A dead or forfeited ranked attempt keeps its entry in the pool. Rival entries and times are generated from the
day's seed and labelled **SIMULATED**. Everything resets on reload (the sandbox has no storage). This prototype
does not use the SDK chance-game actions: entries are a fixed fee, not a chance purchase. The required
`game.json` carries **unused schema-only terms** (1 RF, a single 10,000 bps reward of 1 RF, both
`1000000000000000000` base units).

## Replay verification (anti-cheat)

The simulation runs at a **fixed 60 Hz step**. All gameplay randomness comes from the day's seed, and cosmetic
randomness uses a separate generator. Each tick's input is recorded as 4 signed bytes (move and aim), plus the
index of the power-up chosen. A finished ranked run is **re-simulated from scratch** from those inputs before it
counts. If the recomputed time, hits and outcome don't match, the run is rejected. **Watch replay** plays the
recorded inputs back through the same engine. In production this check runs on a server before payouts (see
ECONOMY.md).

## How the Friends are chosen

The day's seed samples 120 token IDs in 1–100,000 and reads their families from the SDK's pinned sprite registry
(`familyOf`). It groups them into four casts (rooms 1–3, 4–5, 6–7, 8–10) and reads `seedOf` and the canonical
`frames`, using Multicall3 with a fallback to batched reads. Only the public artwork registry is read. The
collection is never scanned and no owners are looked up.

## Checks

- `npx friendsdk check games/daily-crypt` and `npx tsc -p games/daily-crypt/tsconfig.json`.
- `node games/daily-crypt/tests/run-sim.mjs`: a bot plays 54 full runs across all nine player families.
  - Every honest run is recorded and **re-verified by replay** (27/27 match).
  - Invulnerable, the bot clears the crypt in 22 of 27 runs. The misses are its aim getting stuck behind rocks.
  - With normal guard it dies around room 4. It doesn't dodge, and the crypt is meant to be hard.
- `node games/daily-crypt/tests/browser.mjs`: the real SDK runtime in headless Chromium with SDK mock
  fixtures. It covers desktop and phone layouts, the ranked-entry flow and play, with no browser errors.
- Known issue: the stock `npx friendsdk test` fixture only answers artwork reads for sample Friend #7730, so
  it rejects the roster reads by design.

## Limitations

- Cross-browser replay: gameplay uses `Math.sin`/`cos`/`atan2`/`hypot`, which can differ in the last bit between
  JavaScript engines. A run recorded in Safari might not replay bit-exactly in V8. Production verification needs
  fixed-point or table-based math (listed in ECONOMY.md).
- The cast depends on the public Robinhood RPC. If a read fails, the game shows Retry.
- Power-ups that don't fit a family perk (e.g. flight for Hoverers) are skipped, so that family sees the next
  ones in the day's order.

## Credits

Code, rooms and sound effects by Fablizio (AI-assisted). Scenery is drawn in code. Character art: canonical Rare
Friends Generations sprites via the FriendSDK sprite reader. Reward cues come from the FriendSDK sound kit (see
`NOTICE.md`). The engine is shared with the builder's Character Spotlight entry, *The Binding of RareFriend*.

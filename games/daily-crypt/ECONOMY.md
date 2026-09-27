# Daily Crypt: economy design

Target category: **Token Activity**, meaning spending and burning $RAREFRIENDS (RF). Everything below is
**simulated in the prototype**. No contract is deployed and no RF moves.

## Flows

```
player ──10 RF──► entry
                   ├── 2 RF (20%) ──► burned forever
                   └── 8 RF (80%) ──► today's pool ──► 00:00 UTC ──► 50% / 30% / 20% to the 3 fastest verified runs
player ── 5 RF──► continue (once per attempt, when the last guard breaks) ──► 100% burned
player ─20–80 RF─► halo (one-time cosmetic) ──────────────────────────────► 100% burned
```

- **Only sink and burn, no minting.** RF is never created by the game. Every RF paid out came from another
  player's entry, and 20% of all entries leave supply.
- **Repeat spending is the core loop.** Attempts are unlimited and each one costs 10 RF. Getting faster means
  replaying the same crypt, and each replay burns 2 RF. The skill ceiling (memorised patterns, hitless routes,
  power-up choice) keeps top players paying for more attempts.
- **Dead or forfeited attempts still pay.** The entry is spent on entering, so a death leaves the burn and the
  pool contribution in place.
- **Practice is free and unranked,** so new players can learn without spending. That keeps spending voluntary and
  tied to competing. Practice's continue is free too, and you can race a ghost of your best run there.
- **The continue is a pure burn at the moment of highest tension.** When the last guard breaks, the clock stops
  and the player gets six seconds to pay 5 RF for +2 guard. It can be bought only once per attempt, and the
  fatal hit still costs +5 s. It saves an attempt but doesn't buy a fast time, so the leaderboard stays a skill
  ranking. None of it goes to the pool, so buying continues can't inflate prizes.
- **Halos are a pure burn with no gameplay value.** Four outline colours at 20–80 RF, bought once. The renderer
  reads them and the simulation never does, so they can't be pay-to-win (tested: identical runs with and
  without a halo).

## Numbers

Entries alone:

| Daily ranked attempts | RF spent | RF burned | Pool | 1st / 2nd / 3rd |
| ---: | ---: | ---: | ---: | --- |
| 50 | 500 | 100 | 400 | 200 / 120 / 80 |
| 200 | 2,000 | 400 | 1,600 | 800 / 480 / 320 |
| 1,000 | 10,000 | 2,000 | 8,000 | 4,000 / 2,400 / 1,600 |

With continues and halos, as in the lobby's projection widget. The **assumptions** are a 25% continue take
rate and one halo sold per 100 attempts at the ~40 RF average. They are guesses to tune against real data, not
measurements.

| Daily ranked attempts | Entry burn | Continue burn | Halo burn | **Burned / day** | **Burned / 30 days** |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 200 | 125 | 40 | **365** | **10,950** |
| 1,000 | 2,000 | 1,250 | 400 | **3,650** | **109,500** |
| 10,000 | 20,000 | 12,500 | 4,000 | **36,500** | **1,095,000** |

Continues and halos raise the burn share of all RF spent from 20% (entries only) to about 31%
(3,650 of 11,650 RF at 1,000 attempts). The pool doesn't change.

In the prototype, **RF burned today** in the lobby counts simulated rival entries, simulated rival continues
(15–30% of entries, seeded by the day) and your own session's entries, continues and halos.

All parameters are launch settings to tune: entry price, burn percentage, split, number of paid places.

## Edge cases

- **Fewer than three verified finishers:** unpaid shares roll into the next day's pool. The burn has already
  happened.
- **Nobody finishes:** the whole pool rolls over, and a bigger pool pulls in more attempts the next day.
- **Cold start:** an optional sponsored floor (a guaranteed minimum pool funded by the team or a partner)
  for the first weeks. Sponsor RF is added to the pool, not minted.
- **Ties:** the earlier verified submission wins.

## Why a player can't fake a time

1. The day's crypt is a pure function of the UTC date: layout, Friends, spawns, elites and power-up offer.
2. The engine runs at a fixed 60 Hz step. All gameplay randomness comes from the seed, and cosmetics use a
   separate generator.
3. The client uploads the **input log** (4 bytes per tick, about 70 KB for a 5-minute run), the power-up choice and
   the tick of each accepted continue, not a time.
4. A verifier re-simulates the log with the same engine and computes the time itself. Only that recomputed time
   is ranked and paid.

The continue is part of the log. The engine stops at a deterministic tick when the last guard breaks. The
replayer accepts the continue only if the log holds that exact tick, and otherwise ends the run there. A log
with more than one continue, or with a continue that doesn't line up with a real offer, is rejected. The
verifier also checks that the entry actually paid for as many continues as the log uses.

In the prototype, step 4 runs in the browser at the end of every ranked run. **Watch replay** shows the log
playing back identically.

**Production requirement:** gameplay currently uses floating-point `Math.sin/cos/atan2/hypot`. Those are not
guaranteed bit-identical across JavaScript engines, so the verifier would move to fixed-point or table-based
math. It would also pin the engine version per day.

## Going live (later phase, with the Rare Friends team)

Needs custom integration beyond FriendSDK v0.1.2, which has no leaderboard, persistence or pool APIs:

- **DailyCryptPool contract**, referencing RF and Generations through interfaces:
  - `enter(day, friendId)` pulls 10 RF from the Friend's canonical wallet and burns 2 RF;
  - it adds 8 RF to `pool[day]` and emits an entry ID;
  - the contract checks ownership and eligibility (hardwired Friend) at `enter`;
  - `continueRun(entryId)` burns 5 RF, at most once per entry. The verifier matches it against the log's continue.
    The client already pauses for the offer, so the confirmation fits in the stopped clock (a longer window may be
    needed for a real wallet prompt);
  - `buyHalo(friendId, haloId)` burns the halo price and records ownership per Friend, so halos persist and
    stay cosmetic.
- **Verifier service** that re-simulates submitted logs. After the day closes it posts `settle(day, winners, proofs)`,
  starting with a trusted signer and later moving to multiple verifiers or an optimistic challenge window.
  The contract then pays the winners' canonical Friend wallets.
- **Runtime:** entry confirmation through the SDK's trusted confirmation UI, the same pattern as the fishing
  example's live mode. Game code never touches the signer.
- **Compliance:** paid entry for token prizes can be regulated as a prize contest or game of skill in some
  jurisdictions (Italy included). This needs legal review and possibly geo-restrictions before real-money
  launch.

## Extensions

- **Seasons:** the sum of your best 7 daily times, with a season pool funded by 5% of daily entries (taken from
  the pool share, not the burn).
- **Ghost of the leader:** race the day's #1 replay instead of your own session best. The ghost engine already
  exists, and it only needs the leader's log from the verifier.
- More halos or seasonal halos, still 100% burned and cosmetic.

## Honest limits

- A small player base means a small pool. The rollover and sponsored floor help, but the entry price has to
  match real demand.
- Family perks are not perfectly balanced against each other. The leaderboard shows the family, and a per-family
  board is an easy follow-up.

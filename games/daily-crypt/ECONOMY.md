# Daily Crypt: economy design

Target category: **Token Activity**, meaning spending and burning $RAREFRIENDS (RF). Everything below is
**simulated in the prototype**. No contract is deployed and no RF moves.

## Flows

```
player ──10 RF──► entry
                   ├── 2 RF (20%) ──► burned forever
                   └── 8 RF (80%) ──► today's pool ──► 00:00 UTC ──► 50% / 30% / 20% to the 3 fastest verified runs
```

- **Only sink and burn, no minting.** RF is never created by the game. Every RF paid out came from another
  player's entry, and 20% of all entries leave supply.
- **Repeat spending is the core loop.** Attempts are unlimited and each one costs 10 RF. Getting faster means
  replaying the same crypt, and each replay burns 2 RF. The skill ceiling (memorised patterns, hitless routes,
  power-up choice) keeps top players paying for more attempts.
- **Dead or forfeited attempts still pay.** The entry is spent on entering, so a death leaves the burn and the
  pool contribution in place.
- **Practice is free and unranked,** so new players can learn without spending. That keeps spending voluntary and
  tied to competing.

## Numbers

| Daily ranked attempts | RF spent | RF burned | Pool | 1st / 2nd / 3rd |
| ---: | ---: | ---: | ---: | --- |
| 50 | 500 | 100 | 400 | 200 / 120 / 80 |
| 200 | 2,000 | 400 | 1,600 | 800 / 480 / 320 |
| 1,000 | 10,000 | 2,000 | 8,000 | 4,000 / 2,400 / 1,600 |

Per year, at a constant 200 attempts a day: **146,000 RF burned**.

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
3. The client uploads the **input log** (4 bytes per tick, about 70 KB for a 5-minute run) and the power-up
   choice, not a time.
4. A verifier re-simulates the log with the same engine and computes the time itself. Only that recomputed time
   is ranked and paid.

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
  - the contract checks ownership and eligibility (hardwired Friend) at `enter`.
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
- **Cosmetic halos** for your Friend in RF, 100% burned, with no gameplay effect.
- **Ghost of the leader:** race the day's #1 replay. The input log makes it possible for free.

## Honest limits

- A small player base means a small pool. The rollover and sponsored floor help, but the entry price has to
  match real demand.
- Family perks are not perfectly balanced against each other. The leaderboard shows the family, and a per-family
  board is an easy follow-up.

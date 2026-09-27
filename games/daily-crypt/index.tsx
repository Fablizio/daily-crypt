"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";
import { Game, TICK, VIEW_H, VIEW_W, HIT_PENALTY, REVIVE_GUARD, type Vec } from "./engine/game";
import { render, formatClock, type GhostView } from "./engine/render";
import { loadDailyRoster, type Roster } from "./engine/roster";
import { createRng } from "./engine/rng";
import { Audio } from "./engine/audio";
import { frameCanvas } from "./engine/sprites";
import { Recorder, quantize, toInput, verify, result, stepRecorded, MAX_TICKS, type RunRecord, type RunResult } from "./engine/replay";
import {
  ENTRY_RF, BURN_PCT, PRIZE_SPLIT, START_BALANCE_RF, REVIVE_RF, HALOS, REVIVE_TAKE_RATE, HALO_PER_ATTEMPT, HALO_AVG_RF,
  burnOf, poolOf, payouts, projection, dayKey, daySeed, msToReset, simulatedDay, rf, type Entry, type HaloId,
} from "./engine/economy";
import { FAMILY_NAMES, PERKS, RELICS, THEMES, type FamilyId, type RelicId } from "./engine/themes";

type Phase = "loading" | "error" | "lobby" | "playing" | "result" | "replay";
type Mode = "ranked" | "practice";
type Stick = { id: number; origin: Vec; at: Vec };
type Outcome = { mode: Mode; result: RunResult; record: RunRecord; splits: number[]; room: number; verified: boolean | null; rank: number | null };
/** The session's best run, raced as a ghost in Practice. Won runs beat lost ones; then lower time, or further room. */
type BestRun = { record: RunRecord; result: RunResult; splits: number[]; room: number };
type Cursor = { frame: number; choice: number; revive: number };
type GhostState = { game: Game; record: RunRecord; cursor: Cursor; splits: number[]; delta: number | null; best: BestRun };
const STICK = 70;
const REVIVE_SECONDS = 6;
const PLAY_URL = "https://fablizio.github.io/daily-crypt/";
const PROJECTIONS = [100, 1000, 10000] as const;
const shortClock = (seconds: number) => formatClock(seconds).replace(/^0(\d:)/, "$1");
const better = (a: BestRun, b: BestRun | null) => !b
  || (a.result.status === "won" && b.result.status !== "won")
  || (a.result.status === b.result.status && (a.result.status === "won" ? a.result.time < b.result.time : a.room > b.room || (a.room === b.room && a.result.ticks > b.result.ticks)));
const GROUPS = ["Rooms 1–3", "Rooms 4–5", "Rooms 6–7", "Rooms 8–10"];

function Portrait({ sprites, scale = 4, halo = "#ffffff", label }: { sprites: GenerationSprites; scale?: number; halo?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const source = frameCanvas(sprites.clips.idle[sprites.familyId === 6 ? "right" : "down"][0], scale, "#000000", halo);
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0);
  }, [sprites, scale, halo]);
  return <canvas ref={ref} width={18 * scale} height={18 * scale} className="dc-portrait" role="img" aria-label={label} />;
}

function ghostVerdict(outcome: Outcome, ghost: BestRun) {
  const mine = outcome.result, theirs = ghost.result;
  if (mine.status === "won" && theirs.status === "won") {
    const d = mine.time - theirs.time;
    return Math.abs(d) < 0.005 ? "Dead heat with your ghost." : d < 0 ? `You beat your ghost by ${(-d).toFixed(2)} s.` : `Your ghost was ${d.toFixed(2)} s faster.`;
  }
  if (mine.status === "won") return "You finished; your ghost never did.";
  if (theirs.status === "won") return `Your ghost finished in ${shortClock(theirs.time)}.`;
  return `Your ghost fell in room ${ghost.room}; you fell in room ${outcome.room}.`;
}

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function DailyCrypt({ friendId, client, paused }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const replayRef = useRef<{ record: RunRecord; cursor: Cursor } | null>(null);
  const ghostRef = useRef<GhostState | null>(null);
  const splitsRef = useRef<number[]>([]);
  const shareRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<Audio | null>(null);
  const keys = useRef(new Set<string>());
  const sticks = useRef<{ move: Stick | null; aim: Stick | null; mouse: Vec | null }>({ move: null, aim: null, mouse: null });
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("Verifying your Friend and opening today's crypt…");
  const [player, setPlayer] = useState<GenerationSprites | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [day, setDay] = useState(() => dayKey());
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<"pause" | "settings" | "rules" | "confirm" | "halo" | null>(null);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [touch, setTouch] = useState(false);
  const [choice, setChoice] = useState<readonly RelicId[] | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [balance, setBalance] = useState(START_BALANCE_RF);
  const [myEntries, setMyEntries] = useState(0);
  const [myRuns, setMyRuns] = useState<Entry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [mode, setMode] = useState<Mode>("practice");
  const [revision, setRevision] = useState(0);
  const [revive, setRevive] = useState<{ left: number; free: boolean } | null>(null);
  const [myRevives, setMyRevives] = useState(0);
  const [owned, setOwned] = useState<ReadonlySet<HaloId>>(() => new Set<HaloId>(["bone"]));
  const [equipped, setEquipped] = useState<HaloId>("bone");
  const [haloPick, setHaloPick] = useState<HaloId | null>(null);
  const [haloBurned, setHaloBurned] = useState(0);
  const [best, setBest] = useState<BestRun | null>(null);
  const [ghostOn, setGhostOn] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const [attempts, setAttempts] = useState<number>(1000);
  const live = useRef({ paused, menu, phase, reducedMotion, mode, balance });
  live.current = { paused, menu, phase, reducedMotion, mode, balance };
  const haloColor = HALOS.find(h => h.id === equipped)!.color;

  const seed = useMemo(() => daySeed(day), [day]);
  const sim = useMemo(() => simulatedDay(day), [day]);
  const totalEntries = sim.entries + myEntries;
  const pool = poolOf(totalEntries), prizes = payouts(pool);
  // Burned today (simulated): entry burns (everyone) + continues (simulated rivals and yours) + your halo purchases.
  const entryBurn = burnOf(totalEntries), reviveBurn = (sim.revives + myRevives) * REVIVE_RF;
  const burned = entryBurn + reviveBurn + haloBurned;
  const mySpent = myEntries * ENTRY_RF + myRevives * REVIVE_RF + haloBurned;
  const myBurn = burnOf(myEntries) + myRevives * REVIVE_RF + haloBurned;
  const proj = projection(attempts);
  const board = useMemo(() => [...sim.rivals, ...myRuns].sort((a, b) => a.time - b.time), [sim, myRuns]);
  const myBest = myRuns.length ? Math.min(...myRuns.map(run => run.time)) : null;
  const myRank = myBest === null ? null : board.findIndex(entry => entry.you && entry.time === myBest) + 1;

  const clearInput = useCallback(() => { keys.current.clear(); sticks.current = { move: null, aim: null, mouse: null }; }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)"), coarse = window.matchMedia("(pointer: coarse)");
    const update = () => { setReducedMotion(motion.matches); setTouch(coarse.matches); };
    update(); motion.addEventListener("change", update); coarse.addEventListener("change", update);
    audioRef.current = new Audio();
    const clock = setInterval(() => { setNow(Date.now()); setDay(dayKey()); }, 1000);
    return () => { motion.removeEventListener("change", update); coarse.removeEventListener("change", update); clearInterval(clock); audioRef.current?.dispose(); audioRef.current = null; };
  }, []);
  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);
  useEffect(() => { if (gameRef.current) gameRef.current.reducedMotion = reducedMotion; }, [reducedMotion]);
  useEffect(() => { if (gameRef.current) gameRef.current.halo = haloColor; }, [haloColor]);
  useEffect(() => { if (paused || menu) clearInput(); }, [paused, menu, clearInput]);

  // Session, the player's artwork and today's cast (the same for every player).
  useEffect(() => {
    let cancelled = false;
    gameRef.current = null; ghostRef.current = null; setRoster(null); setPhase("loading"); setMenu(null); setOutcome(null); setChoice(null); setRevive(null);
    setBest(null); setGhostOn(false);
    setStatus("Verifying your Friend and opening today's crypt…");
    (async () => {
      const [snapshot, sprites] = await Promise.all([client.read(), createFriendReader().read(friendId)]);
      if (snapshot.friendId !== friendId) throw new Error("This game session does not match the selected Friend.");
      if (cancelled) return;
      setPlayer(sprites);
      setStatus("Summoning today's Friends from Robinhood Chain…");
      const cast = await loadDailyRoster(createRng(seed));
      if (cancelled) return;
      setRoster(cast); setPhase("lobby");
    })().catch(cause => {
      if (cancelled) return;
      setPhase("error");
      setStatus(cause instanceof Error && cause.message.length < 140 ? cause.message : "Today's crypt could not load its Friends. Check your connection and retry.");
    });
    return () => { cancelled = true; };
  }, [friendId, client, seed, revision]);

  const startRun = useCallback((runMode: Mode, withGhost = false) => {
    if (!player || !roster || live.current.paused) return;
    if (runMode === "ranked") {
      if (balance < ENTRY_RF) return;
      setBalance(value => value - ENTRY_RF); setMyEntries(value => value + 1);
    }
    void audioRef.current?.unlock();
    const game = new Game(player, player.familyId as FamilyId, roster, seed);
    game.reducedMotion = live.current.reducedMotion;
    game.touch = window.matchMedia("(pointer: coarse)").matches;
    game.practice = runMode === "practice";
    game.halo = haloColor;
    gameRef.current = game; recorderRef.current = new Recorder(); replayRef.current = null; splitsRef.current = [0];
    // Ghost: an independent Game replaying the session's best run, stepped in lockstep. It never touches `game`.
    const ghostRun = runMode === "practice" && withGhost ? best : null;
    ghostRef.current = ghostRun ? {
      game: new Game(player, ghostRun.record.family, roster, ghostRun.record.seed), record: ghostRun.record,
      cursor: { frame: 0, choice: 0, revive: 0 }, splits: ghostRun.splits, delta: null, best: ghostRun,
    } : null;
    clearInput(); setMode(runMode); setGhostOn(Boolean(ghostRun)); setOutcome(null); setChoice(null); setRevive(null); setCopied(null); setMenu(null); setPhase("playing");
    const controls = window.matchMedia("(pointer: coarse)").matches ? "Left thumb move · right thumb shoot" : "WASD move · arrows or mouse shoot";
    setToast({ text: `${runMode === "ranked" ? "Ranked run (simulated entry)" : ghostRun ? `Practice vs ghost (${shortClock(ghostRun.result.time)})` : "Practice · not ranked"} · ${controls}`, key: Date.now() });
    canvasRef.current?.focus();
  }, [player, roster, seed, balance, clearInput, haloColor, best]);

  const finish = useCallback((game: Game) => {
    const recorder = recorderRef.current!;
    const runMode = live.current.mode;
    const record: RunRecord = { seed, friendId, family: game.playerFamily, frames: recorder.frames(), choices: [...recorder.choices], revives: [...recorder.revives], claimed: result(game) };
    const splits = [...splitsRef.current];
    if (game.status === "won") splits[10] = game.finalTime;
    const base: Outcome = { mode: runMode, result: record.claimed, record, splits, room: game.roomIndex + 1, verified: null, rank: null };
    setOutcome(base); setPhase("result"); setRevive(null); setCopied(null); clearInput();
    const run: BestRun = { record, result: record.claimed, splits, room: game.roomIndex + 1 };
    setBest(current => better(run, current) ? run : current);
    if (runMode !== "ranked" || game.status !== "won" || !player || !roster) return;
    // Recompute the run from its inputs before it counts, as a server would before paying out.
    setVerifying(true);
    setTimeout(() => {
      const check = verify(record, player, roster);
      setVerifying(false);
      if (!check.ok) { setOutcome({ ...base, verified: false }); return; }
      const entry: Entry = { name: `You · Friend #${friendId}`, family: game.playerFamily, time: check.recomputed.time, hits: check.recomputed.hits, you: true, simulated: false };
      setMyRuns(runs => [...runs, entry]);
      const rank = [...sim.rivals, ...myRuns, entry].sort((a, b) => a.time - b.time).indexOf(entry) + 1;
      setOutcome({ ...base, verified: true, rank });
    }, 60);
  }, [seed, friendId, player, roster, sim, myRuns, clearInput]);

  const watchReplay = useCallback(() => {
    if (!outcome || !player || !roster) return;
    const game = new Game(player, outcome.record.family, roster, outcome.record.seed);
    game.reducedMotion = live.current.reducedMotion; game.practice = outcome.mode === "practice"; game.halo = haloColor;
    gameRef.current = game; ghostRef.current = null; replayRef.current = { record: outcome.record, cursor: { frame: 0, choice: 0, revive: 0 } };
    setChoice(null); setRevive(null); setMenu(null); setPhase("replay");
  }, [outcome, player, roster, haloColor]);

  const pick = useCallback((index: number) => {
    const game = gameRef.current;
    if (!game?.choice || live.current.paused) return;
    if (game.choose(index)) { recorderRef.current?.choices.push(index); setChoice(null); audioRef.current?.play("relic"); canvasRef.current?.focus(); }
  }, []);

  // Paid continue. Accepting is recorded as the tick it happened at, so verify() and replays take the same branch.
  const acceptRevive = useCallback(() => {
    const game = gameRef.current, state = live.current;
    if (!game?.reviveOffer || state.paused || state.phase !== "playing") return;
    if (state.mode === "ranked") {
      if (state.balance < REVIVE_RF) return;
      setBalance(value => value - REVIVE_RF); setMyRevives(value => value + 1);
    }
    recorderRef.current?.revives.push(game.ticks);
    game.revive();
    for (const event of game.drainEvents()) if (event.type === "sfx") audioRef.current?.play(event.sfx);
    setRevive(null); clearInput();
    setToast({ text: `Continue · +${REVIVE_GUARD} guard${state.mode === "ranked" ? ` · ${REVIVE_RF} RF burned (simulated)` : " · practice, free"}`, key: Date.now() });
    canvasRef.current?.focus();
  }, [clearInput]);
  const declineRevive = useCallback(() => {
    const game = gameRef.current;
    if (!game?.reviveOffer || live.current.phase !== "playing") return;
    game.declineRevive();
    for (const event of game.drainEvents()) if (event.type === "sfx") audioRef.current?.play(event.sfx);
    setRevive(null);
    finishRef.current(game);
  }, []);
  // The offer lasts a few seconds of unpaused time; the run clock itself is already stopped.
  const offerActive = Boolean(revive) && !paused && !menu && phase === "playing";
  useEffect(() => {
    if (!offerActive) return;
    const id = setInterval(() => setRevive(current => current && { ...current, left: Math.max(0, current.left - 0.1) }), 100);
    return () => clearInterval(id);
  }, [offerActive]);
  useEffect(() => { if (revive && revive.left <= 0) declineRevive(); }, [revive, declineRevive]);

  // Fixed-step loop: the sim advances in whole 1/60 s ticks so the recorded inputs replay exactly.
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0, previous = 0, acc = 0;
    const currentInput = (game: Game) => {
      const k = keys.current, st = sticks.current;
      let mx = Number(k.has("d")) - Number(k.has("a")), my = Number(k.has("s")) - Number(k.has("w"));
      let move: Vec | null = mx || my ? (() => { const l = Math.hypot(mx, my); return { x: mx / l, y: my / l }; })() : null;
      if (!move && st.move) {
        const dx = st.move.at.x - st.move.origin.x, dy = st.move.at.y - st.move.origin.y, l = Math.hypot(dx, dy);
        if (l > 6) { const m = Math.min(1, l / STICK); move = { x: dx / l * m, y: dy / l * m }; }
      }
      let ax = Number(k.has("arrowright")) - Number(k.has("arrowleft")), ay = Number(k.has("arrowdown")) - Number(k.has("arrowup"));
      if (ax && ay) ay = 0;
      let aim: Vec | null = ax || ay ? { x: ax, y: ay } : null;
      if (!aim && st.mouse) { const dx = st.mouse.x - game.player.x, dy = st.mouse.y - (game.player.y - 24), l = Math.hypot(dx, dy) || 1; aim = { x: dx / l, y: dy / l }; }
      if (!aim && st.aim) {
        const dx = st.aim.at.x - st.aim.origin.x, dy = st.aim.at.y - st.aim.origin.y, l = Math.hypot(dx, dy);
        if (l > STICK * 0.25) aim = { x: dx / l, y: dy / l };
      }
      return quantize(move, aim);
    };
    const loop = (t: number) => {
      const dt = previous ? Math.min((t - previous) / 1000, 0.1) : 0; previous = t;
      const game = gameRef.current, state = live.current;
      if (game) {
        const running = (state.phase === "playing" || state.phase === "replay") && !state.paused && !state.menu && !document.hidden;
        if (running) {
          acc += dt;
          let steps = 0;
          while (acc >= TICK && steps < 6) {
            acc -= TICK; steps++;
            if (game.status !== "playing") break;
            const replay = replayRef.current;
            if (state.phase === "replay" && replay) {
              if (!stepRecorded(game, replay.record, replay.cursor)) break;
            } else {
              if (game.choice) { setChoice(current => current ?? game.choice); acc = 0; break; }
              if (game.reviveOffer) { setRevive(current => current ?? { left: REVIVE_SECONDS, free: state.mode === "practice" }); acc = 0; break; }
              const q = currentInput(game);
              recorderRef.current?.push(q);
              if (game.ticks >= MAX_TICKS) { game.status = "dead"; }
              game.update(TICK, toInput(q));
              const ghost = ghostRef.current;
              if (ghost) {
                // Lockstep: the ghost advances until it has simulated as many ticks as the live run.
                while (ghost.game.status === "playing" && ghost.game.ticks < game.ticks) {
                  if (!stepRecorded(ghost.game, ghost.record, ghost.cursor)) break;
                  ghost.game.drainEvents();
                }
              }
            }
            for (const event of game.drainEvents()) {
              if (event.type === "sfx") audioRef.current?.play(event.sfx);
              else if (event.type === "boss" && state.phase === "playing") setToast({ text: `BOSS · Friend #${event.enemy.sprites.tokenId}`, key: t });
              else if (event.type === "hit" && state.phase === "playing") setToast({ text: `Hit! +${HIT_PENALTY}s · ${game.guard - event.hits} guard left`, key: t });
              else if (event.type === "room" && state.phase === "playing" && event.index > 0) {
                splitsRef.current[event.index] = game.finalTime;
                const ghost = ghostRef.current, split = ghost?.splits[event.index];
                if (ghost && split !== undefined) ghost.delta = game.finalTime - split;
              }
            }
            if (game.status !== "playing" && state.phase === "playing") { finishRef.current(game); break; }
          }
          if (acc > TICK * 6) acc = 0;
        } else { acc = 0; }
        const ghost = state.phase === "playing" ? ghostRef.current : null;
        let view: GhostView | null = null;
        if (ghost) {
          const g = ghost.game, d = ghost.delta;
          const where = g.status === "won" ? `finished ${shortClock(g.finalTime)}` : g.status === "dead" ? `fell in room ${g.roomIndex + 1}` : `room ${g.roomIndex + 1}`;
          const gap = d === null ? "" : Math.abs(d) < 0.005 ? " · level" : ` · ${d > 0 ? "ahead" : "behind"} by ${Math.abs(d).toFixed(2)} s`;
          view = { game: g, label: `GHOST ${where}${gap}` };
        }
        render(ctx, game, t, view);
        for (const stick of [sticks.current.move, sticks.current.aim]) {
          if (!stick) continue;
          ctx.globalAlpha = 0.35; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(stick.origin.x, stick.origin.y, STICK, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.7; ctx.fillStyle = stick === sticks.current.aim ? "#ccff00" : "#fff";
          const dx = stick.at.x - stick.origin.x, dy = stick.at.y - stick.origin.y, l = Math.hypot(dx, dy), k = l > STICK ? STICK / l : 1;
          ctx.beginPath(); ctx.arc(stick.origin.x + dx * k, stick.origin.y + dy * k, 28, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        if (state.phase === "replay") {
          ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(VIEW_W / 2 - 90, 58, 180, 24);
          ctx.fillStyle = "#ccff00"; ctx.font = "bold 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("● REPLAY", VIEW_W / 2, 75);
        }
      } else { ctx.fillStyle = "#070708"; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2200); return () => clearTimeout(id); }, [toast]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const k = event.key.toLowerCase(), state = live.current;
      if (state.paused) return;
      if (k === "m" && !event.repeat) { setMuted(value => !value); return; }
      if (state.phase === "playing" && !state.menu) {
        if (gameRef.current?.choice && ["1", "2", "3"].includes(k)) { event.preventDefault(); pick(Number(k) - 1); return; }
        if (gameRef.current?.reviveOffer && !event.repeat && (k === "c" || k === "enter")) { event.preventDefault(); acceptRevive(); return; }
        if (gameRef.current?.reviveOffer && !event.repeat && k === "n") { event.preventDefault(); declineRevive(); return; }
        if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { event.preventDefault(); keys.current.add(k); }
        if ((k === "p" || k === "escape") && !event.repeat) { event.preventDefault(); clearInput(); setMenu("pause"); }
      } else if (state.phase === "replay" && (k === "escape" || k === "p")) { setPhase("result"); }
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const blur = () => { clearInput(); if (live.current.phase === "playing" && !live.current.menu) setMenu("pause"); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    window.addEventListener("blur", blur); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", visibility); };
  }, [clearInput, pick, acceptRevive, declineRevive]);

  const shareText = outcome ? [
    `Daily Crypt ${day}`, `Friend #${String(friendId)}`,
    outcome.result.status === "won" ? `${shortClock(outcome.result.time)} (${outcome.result.hits} hit${outcome.result.hits === 1 ? "" : "s"})` : `fell in room ${outcome.room}/10`,
    ...(outcome.result.revives ? [`${outcome.result.revives} continue`] : []),
    outcome.mode === "practice" ? "practice" : outcome.rank ? `rank #${outcome.rank}` : outcome.result.status === "won" ? "unranked" : "ranked attempt",
    PLAY_URL,
  ].join(" · ") : "";
  const copyResult = async () => {
    let ok = false;
    try {
      // The sandboxed frame usually lacks clipboard-write; skip the API when the policy says so (Chromium logs a
      // violation otherwise), and never wait long for a permission that won't come.
      const policy = (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;
      if (!navigator.clipboard || (policy && !policy.allowsFeature("clipboard-write"))) throw new Error("blocked");
      await Promise.race([navigator.clipboard.writeText(shareText), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500))]);
      ok = true;
    } catch {
      try { const area = shareRef.current; if (area) { area.focus(); area.select(); ok = document.execCommand("copy"); } } catch { ok = false; }
    }
    setCopied(ok ? "yes" : "no");
    if (!ok) shareRef.current?.select();
  };

  const toView = (event: React.PointerEvent<HTMLCanvasElement>): Vec => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * VIEW_W / rect.width, y: (event.clientY - rect.top) * VIEW_H / rect.height };
  };
  const active = phase === "playing" && !paused && !menu && !choice && !revive;
  const game = gameRef.current;
  const family = (player?.familyId ?? 0) as FamilyId;
  const guard = family === 6 ? 7 : 6;
  const lastSpot = board.length >= 3 ? board[2].time : null;

  return <section className="dc-game" aria-label="Daily Crypt, a daily time-attack dungeon">
    <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} className="dc-canvas" tabIndex={active ? 0 : -1}
      aria-label="Crypt room. WASD to move, arrow keys or mouse to shoot. On touch, left thumb moves, right thumb shoots. P pauses."
      onPointerDown={event => {
        if (!active) return;
        event.preventDefault(); event.currentTarget.focus();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
        const at = toView(event);
        if (event.pointerType === "mouse") { if (event.button === 0) sticks.current.mouse = at; return; }
        const stick = { id: event.pointerId, origin: at, at };
        if (at.x < VIEW_W / 2) { if (!sticks.current.move) sticks.current.move = stick; } else if (!sticks.current.aim) sticks.current.aim = stick;
      }}
      onPointerMove={event => {
        if (!active) return;
        const at = toView(event);
        if (event.pointerType === "mouse") { if (sticks.current.mouse) sticks.current.mouse = at; return; }
        if (sticks.current.move?.id === event.pointerId) sticks.current.move.at = at;
        if (sticks.current.aim?.id === event.pointerId) sticks.current.aim.at = at;
      }}
      onPointerUp={event => {
        if (event.pointerType === "mouse") { sticks.current.mouse = null; return; }
        if (sticks.current.move?.id === event.pointerId) sticks.current.move = null;
        if (sticks.current.aim?.id === event.pointerId) sticks.current.aim = null;
      }}
      onPointerCancel={() => clearInput()} onContextMenu={event => event.preventDefault()} />

    {(phase === "playing" || phase === "replay") && <div className="dc-side">
      {phase === "playing"
        ? <button type="button" onClick={() => { clearInput(); setMenu("pause"); }} disabled={paused} aria-label="Pause">II</button>
        : <button type="button" onClick={() => setPhase("result")} disabled={paused} aria-label="Stop replay">■</button>}
      <button type="button" onClick={() => setMuted(value => !value)} disabled={paused} aria-label={muted ? "Sound on" : "Sound off"} aria-pressed={muted}>{muted ? "♪̸" : "♪"}</button>
    </div>}
    {toast && phase === "playing" && <div className="dc-toast" key={toast.key} role="status">{toast.text}</div>}

    {choice && phase === "playing" && !menu && <div className="dc-choice" role="dialog" aria-label="Choose a power-up">
      <h2>Room 5 cleared: choose one power-up</h2>
      <p>Everyone gets the same three today. The clock is stopped.</p>
      <div className="dc-cards">
        {choice.map((id, index) => { const relic = RELICS.find(r => r.id === id)!; return <button key={id} type="button" disabled={paused} onClick={() => pick(index)}>
          <small>{touch ? "" : `${index + 1} · `}Power-up</small><strong>{relic.name}</strong><span>{relic.text}</span></button>; })}
      </div>
    </div>}

    {revive && phase === "playing" && !menu && <div className="dc-choice dc-revive" role="alertdialog" aria-label="Guard broken. Continue?">
      <h2>Guard broken</h2>
      <p>The clock is stopped. Continue once with <b>+{REVIVE_GUARD} guard</b>? The hit still counts (+{HIT_PENALTY}s).</p>
      <div className="dc-timer" aria-hidden="true"><i style={{ width: `${(revive.left / REVIVE_SECONDS) * 100}%` }} /></div>
      <p className="dc-small" aria-live="polite">Offer ends in {Math.ceil(revive.left)} s{touch ? "" : " · C or Enter continue · N end run"}</p>
      <div className="dc-actions">
        <button type="button" className="dc-primary" disabled={paused || (!revive.free && balance < REVIVE_RF)} onClick={acceptRevive}>
          {revive.free ? "Continue · free (practice)" : `Continue · ${REVIVE_RF} RF (100% burned)`}</button>
        <button type="button" disabled={paused} onClick={declineRevive}>End run</button>
      </div>
      {!revive.free && <p className="dc-small"><span className="dc-sim">SIMULATED</span> Balance {rf(balance)}{balance < REVIVE_RF ? " · not enough RF" : ""} · once per ranked attempt · verified by replay</p>}
    </div>}

    {(phase === "loading" || phase === "error") && <div className="dc-screen" role={phase === "error" ? "alert" : "status"}>
      <h1 className="dc-logo">DAILY <em>CRYPT</em></h1>
      <p>{status}</p>
      {phase === "loading" && <div className="dc-spinner" aria-hidden="true" />}
      {phase === "error" && <button type="button" className="dc-primary" disabled={paused} onClick={() => setRevision(v => v + 1)}>Retry</button>}
    </div>}

    {phase === "lobby" && player && roster && !menu && <div className="dc-screen dc-lobby">
      <header className="dc-head">
        <h1 className="dc-logo">DAILY <em>CRYPT</em></h1>
        <p>{day} · same crypt for everyone · resets in <b>{countdown(msToReset(now))}</b></p>
      </header>
      <div className="dc-cols">
        <div className="dc-col">
          <div className="dc-hero">
            <Portrait sprites={player} scale={5} halo={haloColor} label={`Your Friend number ${String(friendId)}`} />
            <div><strong>Friend #{String(friendId)}</strong><span>{player.familyName} · Perk: <b>{PERKS[family].name}</b></span><span>{guard} guard · no healing · +{HIT_PENALTY}s per hit</span></div>
          </div>
          <ol className="dc-route" aria-label="Today's crypt">
            {roster.floors.map((cast, i) => <li key={i} style={{ borderColor: THEMES[cast.family].accent }}><small>{GROUPS[i]}</small><b>{FAMILY_NAMES[cast.family]}</b></li>)}
          </ol>
          <div className="dc-actions">
            <button type="button" className="dc-primary" disabled={paused || balance < ENTRY_RF} onClick={() => setMenu("confirm")}>Ranked run · {ENTRY_RF} RF</button>
            <button type="button" disabled={paused} onClick={() => startRun("practice")}>Practice (free)</button>
            {best && <button type="button" disabled={paused} onClick={() => startRun("practice", true)}>Race ghost · {best.result.status === "won" ? shortClock(best.result.time) : `room ${best.room}`}</button>}
            <button type="button" disabled={paused} onClick={() => setMenu("rules")}>Rules</button>
            <button type="button" disabled={paused} onClick={() => setMenu("settings")}>Settings</button>
          </div>
          <p className="dc-wallet"><span className="dc-sim">SIMULATED</span> Balance <b>{rf(balance)}</b> · entries <b>{myEntries}</b> · you spent <b>{rf(mySpent)}</b>, burned <b>{rf(myBurn)}</b></p>
          <div className="dc-halos" role="group" aria-label="Halo shop: cosmetic outline colours, simulated RF, 100% burned">
            <small>Halo shop <span className="dc-sim">SIMULATED</span> cosmetic only · 100% burned</small>
            <div>{HALOS.map(h => {
              const has = owned.has(h.id), on = equipped === h.id;
              return <button key={h.id} type="button" disabled={paused} aria-pressed={on} className={on ? "on" : ""}
                aria-label={`${h.name} halo, ${has ? (on ? "equipped" : "owned, equip") : `buy for ${h.price} RF`}`}
                onClick={() => { if (has) setEquipped(h.id); else { setHaloPick(h.id); setMenu("halo"); } }}>
                <i style={{ background: h.color }} /><span>{h.name}</span><small>{on ? "equipped" : has ? "owned" : `${h.price} RF`}</small>
              </button>;
            })}</div>
          </div>
        </div>
        <div className="dc-col">
          <div className="dc-burnbox">
            <small>🔥 RF burned today <span className="dc-sim">SIMULATED</span></small>
            <b>{rf(burned)}</b>
            <span>entries {rf(entryBurn)} · continues {rf(reviveBurn)} · halos {rf(haloBurned)}</span>
          </div>
          <div className="dc-pool">
            <div><small>Today's pool</small><b>{rf(pool)}</b></div>
            <div><small>Entries</small><b>{totalEntries}</b></div>
            <div><small>Continues</small><b>{sim.revives + myRevives}</b></div>
          </div>
          <p className="dc-split">Top 3 at reset: {prizes.map((p, i) => `${i + 1}° ${rf(p)}`).join(" · ")}</p>
          <div className="dc-proj" role="group" aria-label="Burn projection">
            <div className="dc-proj-pick"><small>Projection at</small>
              {PROJECTIONS.map(n => <button key={n} type="button" aria-pressed={attempts === n} className={attempts === n ? "on" : ""} disabled={paused} onClick={() => setAttempts(n)}>{n.toLocaleString("en-US")}</button>)}
              <small>ranked attempts/day</small></div>
            <p>→ <b>{rf(proj.day)}</b> burned/day · <b>{rf(proj.month)}</b>/month</p>
            <p className="dc-small">{BURN_PCT}% of each {ENTRY_RF} RF entry ({rf(proj.entries)}) + {REVIVE_TAKE_RATE * 100}% of attempts buying a {REVIVE_RF} RF continue ({rf(proj.revives)}) + 1 halo per {1 / HALO_PER_ATTEMPT} attempts at ~{HALO_AVG_RF} RF ({rf(proj.halos)}). Assumed rates, not data; 30-day month.</p>
          </div>
          <table className="dc-board">
            <caption>Leaderboard <span className="dc-sim">SIMULATED</span></caption>
            <tbody>{board.slice(0, 5).map((entry, i) => <tr key={`${entry.name}-${entry.time}`} className={entry.you ? "you" : ""}>
              <td>{i + 1}</td><td>{entry.name}</td><td>{formatClock(entry.time)}</td></tr>)}
              {myRank !== null && myRank > 5 && <tr className="you"><td>{myRank}</td><td>You</td><td>{formatClock(myBest!)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>}

    {phase === "result" && outcome && !menu && <div className="dc-screen dc-result" role="status">
      {outcome.result.status === "won" ? <>
        <h1 className="dc-logo">{formatClock(outcome.result.time)}</h1>
        <p>Clear {formatClock(outcome.result.ticks * TICK)} + {outcome.result.hits} hit{outcome.result.hits === 1 ? "" : "s"} × {HIT_PENALTY}s</p>
        {outcome.mode === "practice" ? <p className="dc-note">Practice run: not ranked.</p>
          : verifying ? <p className="dc-note">Verifying replay… recomputing {outcome.record.frames.length / 4} ticks</p>
          : outcome.verified ? <p className="dc-ok">✓ Replay verified · rank <b>#{outcome.rank}</b> today{outcome.rank && outcome.rank <= 3 ? ` · on track for ${rf(prizes[outcome.rank - 1])} (simulated)` : lastSpot ? ` · top 3 needs ${formatClock(lastSpot)}` : ""}</p>
          : <p className="dc-bad">✗ Replay did not match. Run rejected.</p>}
      </> : <>
        <h1 className="dc-logo">BOUND</h1>
        <p>Friend #{String(friendId)} fell in room {outcome.room}/10 after {outcome.result.hits} hits.</p>
        <p className="dc-note">{outcome.mode === "ranked" ? `Ranked attempt lost (${ENTRY_RF} RF entry stays in the pool).` : "Practice run."}</p>
      </>}
      {outcome.result.revives > 0 && <p className="dc-note">Used {outcome.result.revives} continue{outcome.mode === "ranked" ? ` (${REVIVE_RF} RF burned, simulated)` : " (practice, free)"} · recorded in the replay</p>}
      {ghostOn && outcome.mode === "practice" && ghostRef.current && <p className="dc-note">{ghostVerdict(outcome, ghostRef.current.best)}</p>}
      <div className="dc-actions">
        <button type="button" className="dc-primary" disabled={paused || balance < ENTRY_RF} onClick={() => setMenu("confirm")}>Ranked run · {ENTRY_RF} RF</button>
        <button type="button" disabled={paused} onClick={() => startRun("practice")}>Practice</button>
        {best && <button type="button" disabled={paused} onClick={() => startRun("practice", true)}>Race ghost</button>}
        <button type="button" disabled={paused} onClick={watchReplay}>Watch replay</button>
        <button type="button" disabled={paused} onClick={() => { gameRef.current = null; ghostRef.current = null; setPhase("lobby"); }}>Lobby</button>
      </div>
      <div className="dc-share">
        <textarea ref={shareRef} readOnly rows={2} value={shareText} aria-label="Result text to share" onFocus={e => e.currentTarget.select()} />
        <div><button type="button" disabled={paused} onClick={copyResult}>Copy result</button>
          {copied === "yes" && <span className="dc-ok" role="status">Copied ✓</span>}
          {copied === "no" && <span className="dc-note" role="status">Copy blocked here: select the text and copy it.</span>}</div>
      </div>
      <p className="dc-wallet"><span className="dc-sim">SIMULATED</span> Balance <b>{rf(balance)}</b> · pool <b>{rf(pool)}</b> · burned today <b>{rf(burned)}</b></p>
    </div>}

    {menu === "confirm" && <GameMenu title="Ranked entry (simulated)" onClose={() => setMenu(null)}>
      <p>Spend <b>{ENTRY_RF} RF</b> from your simulated balance ({rf(balance)}) for one ranked attempt at today's crypt.</p>
      <ul className="dc-list">
        <li>🔥 {BURN_PCT}% burned: <b>{rf(ENTRY_RF * BURN_PCT / 100)}</b></li>
        <li>🏆 {100 - BURN_PCT}% to today's pool: <b>{rf(ENTRY_RF * (100 - BURN_PCT) / 100)}</b></li>
        <li>Pool pays the top 3 at 00:00 UTC: {PRIZE_SPLIT.join(" / ")}%</li>
        <li>Once per attempt, when your guard breaks: <b>Continue · {REVIVE_RF} RF</b> (100% burned) for +{REVIVE_GUARD} guard. Optional.</li>
        <li>Dying loses the attempt. Only replay-verified times rank.</li>
      </ul>
      <p className="dc-small">Prototype: no real RF moves and no transaction is requested.</p>
      <div className="dc-menu-actions">
        <button type="button" className="rf-frame-primary" disabled={paused || balance < ENTRY_RF} onClick={() => startRun("ranked")}>Enter · {ENTRY_RF} RF</button>
        <button type="button" disabled={paused} onClick={() => setMenu(null)}>Cancel</button>
      </div>
    </GameMenu>}
    {menu === "halo" && haloPick && (() => {
      const h = HALOS.find(x => x.id === haloPick)!;
      return <GameMenu title={`${h.name} halo (simulated)`} onClose={() => setMenu(null)}>
        <p>Outline your Friend in <b style={{ color: h.color }}>{h.name}</b> for this session. Purely cosmetic: it is drawn by the renderer and never read by the simulation or the replay check.</p>
        {player && <Portrait sprites={player} scale={4} halo={h.color} label={`Preview of the ${h.name} halo`} />}
        <ul className="dc-list"><li>🔥 {h.price} RF, <b>100% burned</b> (nothing goes to the pool)</li><li>Balance {rf(balance)} → {rf(balance - h.price)}</li></ul>
        <p className="dc-small">Prototype: no real RF moves. Ownership lasts this session (the sandbox has no storage).</p>
        <div className="dc-menu-actions">
          <button type="button" className="rf-frame-primary" disabled={paused || balance < h.price} onClick={() => {
            if (balance < h.price || owned.has(h.id)) return;
            setBalance(value => value - h.price); setHaloBurned(value => value + h.price);
            setOwned(current => new Set([...current, h.id])); setEquipped(h.id); setMenu(null);
          }}>Buy · {h.price} RF</button>
          <button type="button" disabled={paused} onClick={() => setMenu(null)}>Cancel</button>
        </div>
      </GameMenu>;
    })()}
    {menu === "pause" && <GameMenu title="Paused" onClose={() => setMenu(null)}>
      <p>The clock is stopped. Room {(game?.roomIndex ?? 0) + 1}/10 · {game ? formatClock(game.finalTime) : ""}</p>
      <label><input type="checkbox" checked={muted} disabled={paused} onChange={e => setMuted(e.target.checked)} /> Mute sound</label>
      <label><input type="checkbox" checked={reducedMotion} disabled={paused} onChange={e => setReducedMotion(e.target.checked)} /> Reduce motion</label>
      <div className="dc-menu-actions">
        <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => setMenu(null)}>Resume</button>
        <button type="button" disabled={paused} onClick={() => { gameRef.current = null; ghostRef.current = null; setRevive(null); setMenu(null); setPhase("lobby"); }}>{mode === "ranked" ? "Forfeit run" : "Quit"}</button>
      </div>
      {mode === "ranked" && <p className="dc-small">Forfeiting a ranked run loses the attempt.</p>}
    </GameMenu>}
    {menu === "settings" && <GameMenu title="Settings" onClose={() => setMenu(null)}>
      <label><input type="checkbox" checked={muted} disabled={paused} onChange={e => setMuted(e.target.checked)} /> Mute sound</label>
      <label><input type="checkbox" checked={reducedMotion} disabled={paused} onChange={e => setReducedMotion(e.target.checked)} /> Reduce motion (no shake, fades or bobbing; still sprite frames)</label>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => setMenu(null)}>Back</button>
    </GameMenu>}
    {menu === "rules" && <GameMenu title="How the Daily Crypt works" onClose={() => setMenu(null)}>
      <ul className="dc-list">
        <li>One crypt a day, identical for everyone: 10 rooms in a line, the same real Friends and the same spawns. It resets at 00:00 UTC.</li>
        <li>Doors open only when the room is empty. Room 5 offers 3 power-ups (the same 3 for everyone); room 10 is the boss.</li>
        <li>No healing. Every hit adds {HIT_PENALTY}s; the {guard}th hit ends the run.</li>
        <li>Your time = clear time + hit penalties. Lowest time wins.</li>
        <li>Ranked entry {ENTRY_RF} RF: {BURN_PCT}% burned, {100 - BURN_PCT}% to the pool, paid {PRIZE_SPLIT.join("/")}% to the top 3. Practice is free and unranked.</li>
        <li>Continue: once per attempt, when your last guard breaks, pay {REVIVE_RF} RF (100% burned) for +{REVIVE_GUARD} guard. Free in Practice. It is recorded and replayed like your inputs.</li>
        <li>Halos: cosmetic outline colours, one-time price, 100% burned. They never change the game.</li>
        <li>Ghost: in Practice, race your best run of this session. It replays its recorded inputs next to you.</li>
        <li>Every ranked time is re-simulated from its recorded inputs before it counts.</li>
      </ul>
      <p className="dc-small">Prototype: balances, entries, pool, burn and rival times are SIMULATED. No RF moves.</p>
      <button type="button" className="rf-frame-primary" disabled={paused} onClick={() => setMenu(null)}>Got it</button>
    </GameMenu>}
  </section>;
}

/** Every floor, enemy behaviour and player perk is keyed to one of the nine Generations families. */

export const FAMILY_NAMES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;
export type FamilyId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type Theme = Readonly<{
  floorName: string;
  tagline: string;
  /** Floor base, floor detail, wall, wall detail, accent (enemy halo, doors, UI). */
  floor: string; floorDetail: string; wall: string; wallDetail: string; accent: string;
  pattern: "bones" | "curtain" | "planks" | "cells" | "shards" | "clouds" | "slabs" | "crystals" | "void";
  obstacle: string;
  enemyName: string;
  enemyVerb: string;
}>;

export const THEMES: Readonly<Record<FamilyId, Theme>> = {
  0: { floorName: "The Ossuary", tagline: "Rattling bones and the Skeletons who wear them.",
    floor: "#cbc2a4", floorDetail: "#b3a986", wall: "#2e2b22", wallDetail: "#4d483a", accent: "#e0483b",
    pattern: "bones", obstacle: "bone pile", enemyName: "Rattler", enemyVerb: "chases you down" },
  1: { floorName: "Masquerade Hall", tagline: "Every face is borrowed. Most of them shoot.",
    floor: "#d9b8c8", floorDetail: "#c49aaf", wall: "#3d1029", wallDetail: "#6a1f47", accent: "#ff2d86",
    pattern: "curtain", obstacle: "prop mask", enemyName: "Mimic", enemyVerb: "keeps its distance, fires and blinks away" },
  2: { floorName: "The Old House", tagline: "The Family is home, and they travel in packs.",
    floor: "#c9a57a", floorDetail: "#b08c62", wall: "#3b2610", wallDetail: "#5e3f1c", accent: "#ff8a00",
    pattern: "planks", obstacle: "old crate", enemyName: "Kin", enemyVerb: "wanders in groups and lunges" },
  3: { floorName: "Culture Vats", tagline: "Cut a Cellular in half and you get two.",
    floor: "#a9d6bd", floorDetail: "#8cc2a4", wall: "#0f3322", wallDetail: "#1b5538", accent: "#00b862",
    pattern: "cells", obstacle: "specimen jar", enemyName: "Cell", enemyVerb: "drifts closer and splits when struck" },
  4: { floorName: "The Crooked Wing", tagline: "Nothing here is symmetrical. Especially the walking.",
    floor: "#bdb3e0", floorDetail: "#a398cf", wall: "#211a45", wallDetail: "#3a2f75", accent: "#6a4dff",
    pattern: "shards", obstacle: "bent pillar", enemyName: "Glitch", enemyVerb: "zigzags and fires crooked shots" },
  5: { floorName: "Cloud Cellar", tagline: "Hoverers float over everything you hide behind.",
    floor: "#b7d7ea", floorDetail: "#9cc3db", wall: "#15314a", wallDetail: "#26557c", accent: "#1e9cf0",
    pattern: "clouds", obstacle: "storm cloud", enemyName: "Drifter", enemyVerb: "flies over rocks in waves" },
  6: { floorName: "Colossus Quarry", tagline: "Slow, heavy, and very sure of the straight line to you.",
    floor: "#d1a88c", floorDetail: "#bb8f72", wall: "#3e1f10", wallDetail: "#6a381c", accent: "#ff5a1f",
    pattern: "slabs", obstacle: "boulder", enemyName: "Brute", enemyVerb: "charges when you line up" },
  7: { floorName: "Glimmer Mines", tagline: "Pretty, until the Sparklings go off.",
    floor: "#d8cf97", floorDetail: "#c3b879", wall: "#3b3410", wallDetail: "#655a1e", accent: "#d99a00",
    pattern: "crystals", obstacle: "crystal", enemyName: "Glint", enemyVerb: "stands still and bursts in rings" },
  8: { floorName: "The Hollow", tagline: "What you cannot see can still bump into you.",
    floor: "#a9abb3", floorDetail: "#93959e", wall: "#141418", wallDetail: "#2a2a31", accent: "#12b8b8",
    pattern: "void", obstacle: "void rift", enemyName: "Shade", enemyVerb: "fades out and reappears beside you" },
};

export type Perk = Readonly<{ name: string; text: string }>;
export const PERKS: Readonly<Record<FamilyId, Perk>> = {
  0: { name: "Bone Through", text: "Your shots pierce enemies." },
  1: { name: "Two Faces", text: "You fire two parallel shots." },
  2: { name: "Never Alone", text: "A little Kin familiar fires with you." },
  3: { name: "Mitosis", text: "Shots split in two when they hit." },
  4: { name: "Off Balance", text: "Wobbly shots deal 25% more damage." },
  5: { name: "Levitation", text: "You fly over pits and rocks." },
  6: { name: "Heavyweight", text: "One extra heart and huge shots, but slower feet." },
  7: { name: "Glitter Bomb", text: "Every sixth shot bursts in eight directions." },
  8: { name: "Phase Skin", text: "Longer invulnerability after a hit, and quicker feet." },
};

export type BossAttack = "ring" | "spread" | "charge" | "summon" | "spiral" | "blink" | "slam";
export const BOSS_ATTACKS: Readonly<Record<FamilyId, readonly BossAttack[]>> = {
  0: ["summon", "spread", "charge"],
  1: ["blink", "spread", "ring"],
  2: ["summon", "charge", "ring"],
  3: ["ring", "summon", "spiral"],
  4: ["spiral", "blink", "spread"],
  5: ["ring", "spiral", "blink"],
  6: ["charge", "slam", "charge"],
  7: ["ring", "spiral", "slam"],
  8: ["blink", "ring", "summon"],
};

export type RelicId = "marrow" | "mask" | "photo" | "petri" | "lens" | "boots" | "knuckle" | "dust" | "hollowheart" | "signal";
export type Relic = Readonly<{ id: RelicId; name: string; text: string }>;
export const RELICS: readonly Relic[] = [
  { id: "marrow", name: "Bone Marrow", text: "+1 heart container, full heal." },
  { id: "mask", name: "Spare Mask", text: "+1 damage." },
  { id: "photo", name: "Family Photo", text: "A Kin familiar joins you." },
  { id: "petri", name: "Petri Dish", text: "Shots split on hit." },
  { id: "lens", name: "Crooked Lens", text: "Faster shooting." },
  { id: "boots", name: "Hover Boots", text: "Fly over pits and rocks." },
  { id: "knuckle", name: "Colossal Knuckle", text: "Bigger, harder-hitting shots." },
  { id: "dust", name: "Sparkle Dust", text: "Faster, longer-range shots." },
  { id: "hollowheart", name: "Hollow Heart", text: "Faster feet, longer invulnerability." },
  { id: "signal", name: "Signal Green", text: "Shots home in on enemies." },
];

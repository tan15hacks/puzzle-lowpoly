export type GridVector = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type LevelDefinition = Readonly<{
  id: string;
  name: string;
  subtitle: string;
  size: GridVector;
  start: GridVector;
  initialGravity: GridVector;
  goal: GridVector;
  crystals: readonly GridVector[];
  blocks: readonly GridVector[];
  hazards: readonly GridVector[];
  parMoves: number;
  tutorial: readonly string[];
}>;

export const LEVELS: readonly LevelDefinition[] = [
  {
    id: "first-shift",
    name: "First Shift",
    subtitle: "Learn to turn walls into floors.",
    size: { x: 5, y: 5, z: 5 },
    start: { x: 0, y: 0, z: 0 },
    initialGravity: { x: 0, y: -1, z: 0 },
    goal: { x: 2, y: 2, z: 4 },
    crystals: [
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 3, z: 2 },
    ],
    blocks: [
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 1, z: 2 },
    ],
    hazards: [],
    parMoves: 13,
    tutorial: [
      "Swipe or use the MOVE pad to walk.",
      "Use the SHIFT pad to rotate the chamber. Walls become floors.",
      "Two-finger swipe anywhere on the chamber also shifts gravity.",
    ],
  },
  {
    id: "orbit-hall",
    name: "Orbit Hall",
    subtitle: "Plan your falls around the central ruins.",
    size: { x: 6, y: 6, z: 6 },
    start: { x: 0, y: 0, z: 0 },
    initialGravity: { x: 0, y: -1, z: 0 },
    goal: { x: 1, y: 3, z: 5 },
    crystals: [
      { x: 5, y: 0, z: 1 },
      { x: 5, y: 4, z: 4 },
      { x: 2, y: 5, z: 4 },
    ],
    blocks: [
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 1, z: 2 },
      { x: 3, y: 0, z: 3 },
      { x: 3, y: 1, z: 3 },
      { x: 1, y: 3, z: 3 },
      { x: 4, y: 2, z: 1 },
    ],
    hazards: [
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 2, z: 3 },
    ],
    parMoves: 20,
    tutorial: [
      "Red cells overload the robot. UNDO returns you to safety.",
      "A shift counts as a move, so choose the shortest route.",
    ],
  },
  {
    id: "core-chamber",
    name: "Core Chamber",
    subtitle: "Master all six faces of the gravity vault.",
    size: { x: 7, y: 7, z: 7 },
    start: { x: 0, y: 0, z: 0 },
    initialGravity: { x: 0, y: -1, z: 0 },
    goal: { x: 0, y: 4, z: 2 },
    crystals: [
      { x: 6, y: 0, z: 0 },
      { x: 6, y: 5, z: 3 },
      { x: 3, y: 6, z: 5 },
      { x: 1, y: 3, z: 6 },
    ],
    blocks: [
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 1, z: 2 },
      { x: 2, y: 2, z: 2 },
      { x: 4, y: 0, z: 4 },
      { x: 4, y: 1, z: 4 },
      { x: 1, y: 4, z: 3 },
      { x: 5, y: 3, z: 1 },
      { x: 3, y: 5, z: 5 },
    ],
    hazards: [
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 6, y: 2, z: 2 },
      { x: 6, y: 3, z: 2 },
      { x: 2, y: 6, z: 4 },
      { x: 2, y: 2, z: 6 },
    ],
    parMoves: 29,
    tutorial: ["Use everything you learned. The core opens only after every shard is restored."],
  },
];

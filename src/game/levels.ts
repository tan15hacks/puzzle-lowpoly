export type GridPosition = Readonly<{
  x: number;
  z: number;
}>;

export type LevelDefinition = Readonly<{
  name: string;
  map: readonly string[];
  start: GridPosition;
  goal: GridPosition;
  crystals: readonly GridPosition[];
}>;

export const LEVEL_ONE: LevelDefinition = {
  name: "Cloud Shrine",
  map: [
    "#########",
    "#...#...#",
    "#.#.#.#.#",
    "#.#...#.#",
    "#..##.#.#",
    "#.....#.#",
    "###.#...#",
    "#...#...#",
    "#########",
  ],
  start: { x: 1, z: 1 },
  goal: { x: 7, z: 7 },
  crystals: [
    { x: 7, z: 1 },
    { x: 1, z: 5 },
    { x: 5, z: 7 },
  ],
};

# Gravity Grid

A mobile-first low-poly puzzle game built with Three.js, TypeScript, and Vite.

## Current prototype

The first playable level includes:

- A stylized isometric low-poly environment
- Grid-based movement
- Keyboard, on-screen button, and swipe controls
- Ninety-degree stage rotation
- Screen-relative movement after rotating the board
- Three collectible energy crystals
- A portal that unlocks after all crystals are collected
- Move counter, restart flow, particles, and completion screen
- Responsive portrait and landscape layouts

## Controls

| Action | Keyboard | Mobile |
| --- | --- | --- |
| Move | Arrow keys or WASD | Swipe or directional pad |
| Rotate stage | Q / E | Rotate buttons |
| Restart | R | Restart button |

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Production build

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
├── game/
│   ├── Game.ts       # Rendering, controls, movement, effects, and game state
│   └── levels.ts     # Puzzle level definitions
├── main.ts           # Application entry point
├── style.css         # Responsive HUD and mobile controls
└── vite-env.d.ts
```

## Development direction

This prototype establishes the visual style and core interaction foundation. Planned milestones include true gravity-axis rotation, hazards, movable blocks, multiple levels, audio, save data, settings, and Android packaging through Capacitor.

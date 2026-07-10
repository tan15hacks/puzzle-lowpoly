# Gravity Grid

A mobile-first low-poly 3D puzzle game built with Three.js, TypeScript, and Vite.

Rotate the puzzle chamber, change gravity, turn walls into floors, collect every energy shard, and reach the portal in as few moves as possible.

## Current gameplay

Version 0.2 includes:

- True six-face gravity movement inside a rotatable 3D chamber
- Smooth 90-degree chamber shifts and falling resolution
- Three validated, completable puzzle chambers
- Collectible shards, portals, obstacles, and overload hazards
- Undo, restart, move counts, par targets, star ratings, and saved best scores
- Buffered input so fast taps are not lost during animations
- Procedural sound effects, vibration feedback, particles, and impact feedback
- Adaptive render resolution for slower mobile devices
- Reduced-motion support

## Controls

### Desktop

| Action | Keys |
| --- | --- |
| Move | Arrow keys or WASD |
| Shift gravity | I/J/K/L |
| Shift left/right | Q/E |
| Undo | Z or U |
| Restart | R |
| Toggle sound | M |

### Mobile and tablet

- Use the left **MOVE** pad to walk.
- Use the right **SHIFT** pad to rotate the chamber.
- One-finger swipe on the chamber to move.
- Two-finger swipe on the chamber to shift gravity.
- Hold a MOVE button to continue walking.
- Use **UNDO** after a mistake or dangerous landing.

The interface supports portrait and landscape layouts, device safe areas, touch targets, Android phones and tablets, iPhone, and iPad.

## Run locally

```bash
npm install
npm run dev -- --host
```

Vite will show both a local URL and a network URL. Open the network URL on a phone or tablet connected to the same Wi-Fi network.

## Production build

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
├── game/
│   ├── Game.ts       # Rendering, gravity simulation, input, audio, effects, and progression
│   └── levels.ts     # Reusable 3D chamber definitions
├── main.ts           # Application entry point
├── style.css         # Responsive HUD and touch controls
└── vite-env.d.ts
```

## Development roadmap

1. Playtest and tune the three gravity chambers on real phones and tablets
2. Add movable crates, switches, doors, and teleporters
3. Add a level-select screen and expanded world progression
4. Add music, accessibility settings, and richer visual effects
5. Add more puzzle worlds and cosmetic robot skins
6. Run an early Capacitor Android test build
7. Finish Android packaging, store assets, signing, ads, and release preparation

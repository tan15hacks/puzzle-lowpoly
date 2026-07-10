import * as THREE from "three";
import { LEVELS, type GridVector, type LevelDefinition } from "./levels";

type MoveAction = "move-up" | "move-down" | "move-left" | "move-right";
type TiltAction = "tilt-up" | "tilt-down" | "tilt-left" | "tilt-right";
type GameAction = MoveAction | TiltAction | "undo" | "reset" | "sound" | "replay" | "next";

type MotionAnimation = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  elapsed: number;
  duration: number;
  kind: "move" | "fall";
  destination: GridVector;
  facing: GridVector;
};

type RotationAnimation = {
  from: THREE.Quaternion;
  to: THREE.Quaternion;
  elapsed: number;
  duration: number;
};

type BurstParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
};

type Snapshot = {
  playerCell: GridVector;
  gravity: GridVector;
  stageQuaternion: readonly [number, number, number, number];
  collected: readonly string[];
  moves: number;
};

type GesturePoint = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type BestScores = Record<string, number>;

const COLORS = {
  sky: 0x8fd3ff,
  fog: 0xcbeeff,
  chamber: 0xe7f5ff,
  chamberLine: 0x7692b5,
  frame: 0xffffff,
  block: 0xf2eee5,
  blockSide: 0xbeb8ad,
  player: 0xffc857,
  playerDark: 0x35425d,
  playerGlow: 0xffe79b,
  crystal: 0x56efff,
  portalLocked: 0x69738e,
  portalOpen: 0x8b68ff,
  hazard: 0xff5570,
  soil: 0x8a6a4b,
} as const;

const WORLD_DOWN = new THREE.Vector3(0, -1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PLAYER_BASE_HEIGHT = 0.02;
const STORAGE_MUTED = "gravity-grid:muted";
const STORAGE_BEST = "gravity-grid:best-scores";

const easeInOutCubic = (value: number): number =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

const easeOutBack = (value: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
};

const vectorKey = ({ x, y, z }: GridVector): string => `${x}:${y}:${z}`;

const cloneVector = ({ x, y, z }: GridVector): GridVector => ({ x, y, z });

const addVectors = (a: GridVector, b: GridVector): GridVector => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

const vectorsEqual = (a: GridVector, b: GridVector): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

const gridDistance = (a: GridVector, b: GridVector): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

const getRequiredElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Required UI element #${id} was not found.`);
  }
  return element as T;
};

const safeParseBestScores = (): BestScores => {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_BEST);
    if (rawValue === null) {
      return {};
    }
    const parsed = JSON.parse(rawValue) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed as BestScores;
  } catch {
    return {};
  }
};

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  private readonly clock = new THREE.Clock();
  private readonly stageRoot = new THREE.Group();
  private readonly chamberGroup = new THREE.Group();
  private readonly environmentGroup = new THREE.Group();
  private readonly crystalMeshes = new Map<string, THREE.Group>();
  private readonly hazardMeshes: THREE.Group[] = [];
  private readonly particles: BurstParticle[] = [];
  private readonly blockKeys = new Set<string>();
  private readonly hazardKeys = new Set<string>();
  private readonly collectedCrystalKeys = new Set<string>();
  private readonly history: Snapshot[] = [];
  private readonly gesturePoints = new Map<number, GesturePoint>();
  private readonly activeGesturePointers = new Set<number>();
  private readonly bestScores = safeParseBestScores();
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  private readonly levelNumberElement = getRequiredElement<HTMLElement>("level-number");
  private readonly levelNameElement = getRequiredElement<HTMLElement>("level-name");
  private readonly levelSubtitleElement = getRequiredElement<HTMLElement>("level-subtitle");
  private readonly crystalCountElement = getRequiredElement<HTMLElement>("crystal-count");
  private readonly moveCountElement = getRequiredElement<HTMLElement>("move-count");
  private readonly bestCountElement = getRequiredElement<HTMLElement>("best-count");
  private readonly gravityIconElement = getRequiredElement<HTMLElement>("gravity-icon");
  private readonly gravityLabelElement = getRequiredElement<HTMLElement>("gravity-label");
  private readonly hintElement = getRequiredElement<HTMLElement>("hint");
  private readonly gestureGuideElement = getRequiredElement<HTMLElement>("gesture-guide");
  private readonly impactFlashElement = getRequiredElement<HTMLElement>("impact-flash");
  private readonly resultPanel = getRequiredElement<HTMLElement>("result-panel");
  private readonly resultTitle = getRequiredElement<HTMLElement>("result-title");
  private readonly resultSummary = getRequiredElement<HTMLElement>("result-summary");
  private readonly resultStars = getRequiredElement<HTMLElement>("result-stars");
  private readonly resultMoves = getRequiredElement<HTMLElement>("result-moves");
  private readonly resultPar = getRequiredElement<HTMLElement>("result-par");
  private readonly resultBest = getRequiredElement<HTMLElement>("result-best");
  private readonly nextButton = getRequiredElement<HTMLButtonElement>("next-button");
  private readonly soundIconElement = getRequiredElement<HTMLElement>("sound-icon");
  private readonly soundLabelElement = getRequiredElement<HTMLElement>("sound-label");

  private levelIndex = 0;
  private level: LevelDefinition = LEVELS[0] as LevelDefinition;
  private player = new THREE.Group();
  private playerCell: GridVector = cloneVector(this.level.start);
  private gravity: GridVector = cloneVector(this.level.initialGravity);
  private lastFacing: GridVector = { x: 0, y: 0, z: 1 };
  private portalGroup = new THREE.Group();
  private portalRing = new THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>();
  private portalCore = new THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>();
  private portalLight = new THREE.PointLight(COLORS.portalLocked, 0, 5);
  private motionAnimation: MotionAnimation | null = null;
  private rotationAnimation: RotationAnimation | null = null;
  private queuedAction: MoveAction | TiltAction | null = null;
  private moves = 0;
  private won = false;
  private tutorialIndex = 0;
  private gestureMaximumPointers = 0;
  private repeatDelayId: number | null = null;
  private repeatIntervalId: number | null = null;
  private guideTimeoutId: number | null = null;
  private hazardTimeoutId: number | null = null;
  private audioContext: AudioContext | null = null;
  private muted = window.localStorage.getItem(STORAGE_MUTED) === "true";
  private targetPixelRatio = 1;
  private frameSampleTotal = 0;
  private frameSampleCount = 0;
  private qualityAdjusted = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });

    this.configureRenderer();
    this.configureScene();
    this.buildEnvironment();
    this.buildLevel(0);
    this.updateSoundHud();
    this.bindControls();
    this.resize();
    this.animate();
  }

  private configureRenderer(): void {
    this.targetPixelRatio = Math.min(window.devicePixelRatio, this.coarsePointer ? 1.25 : 1.6);
    this.renderer.setPixelRatio(this.targetPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.fog, 20, 50);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x59716e, 2.25);
    this.scene.add(hemisphereLight);

    const sun = new THREE.DirectionalLight(0xfff3d4, 3.35);
    sun.position.set(10, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.00045;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x9ad9ff, 1.1);
    fill.position.set(-10, 5, -8);
    this.scene.add(fill);

    this.stageRoot.add(this.chamberGroup);
    this.scene.add(this.stageRoot, this.environmentGroup);
  }

  private buildEnvironment(): void {
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.98,
      flatShading: true,
    });
    const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);

    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      const radius = 14 + (index % 5) * 2.1;
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(
        Math.cos(angle) * radius,
        -5.8 + (index % 4) * 1.1,
        Math.sin(angle) * radius,
      );
      cloud.scale.set(1.7 + (index % 4) * 0.72, 0.55 + (index % 2) * 0.2, 1.2 + (index % 3) * 0.5);
      cloud.rotation.set(index * 0.18, angle, index * 0.13);
      cloud.receiveShadow = true;
      this.environmentGroup.add(cloud);
    }

    const islandGeometry = new THREE.ConeGeometry(1.5, 3.4, 5);
    const islandMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.soil,
      roughness: 1,
      flatShading: true,
    });

    for (let index = 0; index < 11; index += 1) {
      const angle = (index / 11) * Math.PI * 2 + 0.22;
      const island = new THREE.Mesh(islandGeometry, islandMaterial);
      island.position.set(Math.cos(angle) * 19, -5.8 - (index % 3), Math.sin(angle) * 19);
      island.rotation.z = Math.PI;
      island.rotation.y = angle;
      island.scale.setScalar(0.7 + (index % 4) * 0.2);
      island.castShadow = true;
      this.environmentGroup.add(island);
    }
  }

  private buildLevel(index: number): void {
    const nextLevel = LEVELS[index];
    if (nextLevel === undefined) {
      return;
    }

    this.levelIndex = index;
    this.level = nextLevel;
    this.clearLevel();
    this.blockKeys.clear();
    this.hazardKeys.clear();
    this.level.blocks.forEach((position) => this.blockKeys.add(vectorKey(position)));
    this.level.hazards.forEach((position) => this.hazardKeys.add(vectorKey(position)));

    this.createChamberShell();
    this.createBlocks();
    this.createHazards();
    this.createCrystals();
    this.createPortal();

    this.player = this.createPlayer();
    this.playerCell = cloneVector(this.level.start);
    this.gravity = cloneVector(this.level.initialGravity);
    this.lastFacing = this.getDefaultFacing(this.gravity);
    this.player.position.copy(this.playerToLocal(this.playerCell));
    this.orientPlayer(this.lastFacing);
    this.chamberGroup.add(this.player);

    this.stageRoot.quaternion.identity();
    this.collectedCrystalKeys.clear();
    this.history.splice(0, this.history.length);
    this.moves = 0;
    this.won = false;
    this.tutorialIndex = 0;
    this.queuedAction = null;
    this.resultPanel.hidden = true;
    this.nextButton.textContent = this.levelIndex === LEVELS.length - 1 ? "PLAY FROM START" : "NEXT CHAMBER";
    this.updateHud();
    this.updateGravityHud();
    this.showTutorialHint();
    this.showGestureGuide();
    this.resize();
  }

  private clearLevel(): void {
    if (this.hazardTimeoutId !== null) {
      window.clearTimeout(this.hazardTimeoutId);
      this.hazardTimeoutId = null;
    }
    this.motionAnimation = null;
    this.rotationAnimation = null;
    this.particles.splice(0, this.particles.length);
    this.crystalMeshes.clear();
    this.hazardMeshes.splice(0, this.hazardMeshes.length);

    this.chamberGroup.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.chamberGroup.clear();
  }

  private createChamberShell(): void {
    const size = this.level.size;
    const panelMaterial = new THREE.MeshPhysicalMaterial({
      color: COLORS.chamber,
      transparent: true,
      opacity: 0.1,
      roughness: 0.35,
      metalness: 0,
      transmission: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const thickness = 0.08;

    const panels: Array<{ dimensions: [number, number, number]; position: [number, number, number] }> = [
      { dimensions: [size.x, thickness, size.z], position: [0, -size.y / 2 - 0.04, 0] },
      { dimensions: [size.x, thickness, size.z], position: [0, size.y / 2 + 0.04, 0] },
      { dimensions: [thickness, size.y, size.z], position: [-size.x / 2 - 0.04, 0, 0] },
      { dimensions: [thickness, size.y, size.z], position: [size.x / 2 + 0.04, 0, 0] },
      { dimensions: [size.x, size.y, thickness], position: [0, 0, -size.z / 2 - 0.04] },
      { dimensions: [size.x, size.y, thickness], position: [0, 0, size.z / 2 + 0.04] },
    ];

    panels.forEach(({ dimensions, position }) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), panelMaterial.clone());
      panel.position.set(...position);
      panel.renderOrder = -2;
      this.chamberGroup.add(panel);
    });

    const gridSize = Math.max(size.x, size.y, size.z);
    const gridMaterialColor = COLORS.chamberLine;
    const gridConfigs: Array<{ position: THREE.Vector3; rotation: THREE.Euler }> = [
      { position: new THREE.Vector3(0, -size.y / 2, 0), rotation: new THREE.Euler(0, 0, 0) },
      { position: new THREE.Vector3(0, size.y / 2, 0), rotation: new THREE.Euler(0, 0, 0) },
      { position: new THREE.Vector3(-size.x / 2, 0, 0), rotation: new THREE.Euler(0, 0, Math.PI / 2) },
      { position: new THREE.Vector3(size.x / 2, 0, 0), rotation: new THREE.Euler(0, 0, Math.PI / 2) },
      { position: new THREE.Vector3(0, 0, -size.z / 2), rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
      { position: new THREE.Vector3(0, 0, size.z / 2), rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
    ];

    gridConfigs.forEach(({ position, rotation }) => {
      const grid = new THREE.GridHelper(gridSize, gridSize, gridMaterialColor, gridMaterialColor);
      grid.position.copy(position);
      grid.rotation.copy(rotation);
      const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0.22;
        material.depthWrite = false;
      });
      grid.renderOrder = -1;
      this.chamberGroup.add(grid);
    });

    const frameGeometry = new THREE.BoxGeometry(size.x + 0.14, size.y + 0.14, size.z + 0.14);
    const frameEdges = new THREE.EdgesGeometry(frameGeometry);
    frameGeometry.dispose();
    const frame = new THREE.LineSegments(
      frameEdges,
      new THREE.LineBasicMaterial({ color: COLORS.frame, transparent: true, opacity: 0.82 }),
    );
    frame.renderOrder = 2;
    this.chamberGroup.add(frame);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28, 1),
      new THREE.MeshStandardMaterial({
        color: COLORS.portalOpen,
        emissive: COLORS.portalOpen,
        emissiveIntensity: 0.55,
        roughness: 0.32,
        flatShading: true,
      }),
    );
    core.position.set(0, 0, 0);
    core.castShadow = true;
    core.userData.isChamberCore = true;
    this.chamberGroup.add(core);
  }

  private createBlocks(): void {
    const geometry = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const materials = [
      new THREE.MeshStandardMaterial({ color: COLORS.block, roughness: 0.82, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: COLORS.blockSide, roughness: 0.9, flatShading: true }),
    ];

    this.level.blocks.forEach((position, index) => {
      const block = new THREE.Mesh(geometry, materials[index % 2]);
      block.position.copy(this.cellToLocal(position));
      block.rotation.y = (index % 4) * (Math.PI / 2);
      block.castShadow = true;
      block.receiveShadow = true;
      this.chamberGroup.add(block);

      const cap = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.13, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xbdeaff,
          emissiveIntensity: 0.35,
          roughness: 0.5,
          flatShading: true,
        }),
      );
      cap.position.copy(block.position).add(new THREE.Vector3(0, 0.49, 0));
      cap.rotation.y = index;
      this.chamberGroup.add(cap);
    });
  }

  private createHazards(): void {
    this.level.hazards.forEach((position, hazardIndex) => {
      const group = new THREE.Group();
      group.position.copy(this.cellToLocal(position));
      group.userData.phase = hazardIndex * 0.7;

      const plate = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.34, 0),
        new THREE.MeshStandardMaterial({
          color: COLORS.hazard,
          emissive: COLORS.hazard,
          emissiveIntensity: 0.65,
          roughness: 0.42,
          flatShading: true,
        }),
      );
      plate.scale.y = 0.25;
      plate.castShadow = true;
      group.add(plate);

      for (let index = 0; index < 4; index += 1) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.08, 0.3, 5),
          new THREE.MeshStandardMaterial({
            color: 0xffb2bc,
            emissive: COLORS.hazard,
            emissiveIntensity: 0.35,
            flatShading: true,
          }),
        );
        const angle = (index / 4) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 0.2, 0.15, Math.sin(angle) * 0.2);
        spike.castShadow = true;
        group.add(spike);
      }

      this.hazardMeshes.push(group);
      this.chamberGroup.add(group);
    });
  }

  private createCrystals(): void {
    this.level.crystals.forEach((position, index) => {
      const group = new THREE.Group();
      group.position.copy(this.cellToLocal(position));
      group.userData.phase = index * 1.1;

      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28, 0),
        new THREE.MeshStandardMaterial({
          color: COLORS.crystal,
          emissive: COLORS.crystal,
          emissiveIntensity: 1.35,
          roughness: 0.24,
          metalness: 0.08,
          flatShading: true,
        }),
      );
      crystal.castShadow = true;

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.025, 6, 18),
        new THREE.MeshBasicMaterial({ color: COLORS.crystal, transparent: true, opacity: 0.6 }),
      );
      halo.rotation.x = Math.PI / 2;
      group.add(crystal, halo);

      this.crystalMeshes.set(vectorKey(position), group);
      this.chamberGroup.add(group);
    });
  }

  private createPortal(): void {
    const normal = this.getSurfaceNormal(this.level.goal);
    this.portalGroup = new THREE.Group();
    this.portalGroup.position.copy(this.cellToLocal(this.level.goal));
    this.portalGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z));

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.58, 0.18, 8),
      new THREE.MeshStandardMaterial({ color: COLORS.blockSide, roughness: 0.86, flatShading: true }),
    );
    base.rotation.x = Math.PI / 2;
    base.position.z = -0.09;
    base.castShadow = true;
    base.receiveShadow = true;

    const portalMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.portalLocked,
      emissive: COLORS.portalLocked,
      emissiveIntensity: 0.32,
      roughness: 0.3,
      metalness: 0.22,
    });
    this.portalRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.095, 8, 24), portalMaterial);
    this.portalRing.castShadow = true;

    this.portalCore = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 24),
      new THREE.MeshBasicMaterial({
        color: COLORS.portalLocked,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    this.portalCore.position.z = -0.015;

    this.portalLight = new THREE.PointLight(COLORS.portalLocked, 0, 5);
    this.portalLight.position.z = 0.3;

    this.portalGroup.add(base, this.portalCore, this.portalRing, this.portalLight);
    this.chamberGroup.add(this.portalGroup);
  }

  private createPlayer(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.player,
      roughness: 0.66,
      flatShading: true,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.playerDark,
      roughness: 0.75,
      flatShading: true,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.playerGlow,
      emissive: COLORS.playerGlow,
      emissiveIntensity: 0.75,
      roughness: 0.35,
      flatShading: true,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.43, 0.34), bodyMaterial);
    body.position.y = 0.48;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.36, 0.4), bodyMaterial);
    head.position.y = 0.88;

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.105, 0.035), darkMaterial);
    visor.position.set(0, 0.89, 0.218);

    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.015), glowMaterial);
    eye.position.set(0.07, 0.89, 0.239);

    const legGeometry = new THREE.BoxGeometry(0.14, 0.3, 0.16);
    const leftLeg = new THREE.Mesh(legGeometry, darkMaterial);
    leftLeg.position.set(-0.13, 0.15, 0);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.13;

    const armGeometry = new THREE.BoxGeometry(0.11, 0.3, 0.13);
    const leftArm = new THREE.Mesh(armGeometry, darkMaterial);
    leftArm.position.set(-0.3, 0.5, 0);
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.3;

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 6), darkMaterial);
    antenna.position.y = 1.16;
    const antennaTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), glowMaterial);
    antennaTip.position.y = 1.3;

    [body, head, visor, eye, leftLeg, rightLeg, leftArm, rightArm, antenna, antennaTip].forEach((part) => {
      part.castShadow = true;
      part.receiveShadow = true;
      group.add(part);
    });

    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;
    group.userData.leftArm = leftArm;
    group.userData.rightArm = rightArm;
    group.scale.setScalar(0.78);
    return group;
  }

  private cellToLocal(position: GridVector): THREE.Vector3 {
    return new THREE.Vector3(
      position.x - (this.level.size.x - 1) / 2,
      position.y - (this.level.size.y - 1) / 2 + PLAYER_BASE_HEIGHT,
      position.z - (this.level.size.z - 1) / 2,
    );
  }

  private playerToLocal(position: GridVector): THREE.Vector3 {
    return this.cellToLocal(position).add(
      new THREE.Vector3(this.gravity.x, this.gravity.y, this.gravity.z).multiplyScalar(0.5),
    );
  }

  private isInside(position: GridVector): boolean {
    return (
      position.x >= 0 &&
      position.y >= 0 &&
      position.z >= 0 &&
      position.x < this.level.size.x &&
      position.y < this.level.size.y &&
      position.z < this.level.size.z
    );
  }

  private isSolid(position: GridVector): boolean {
    return !this.isInside(position) || this.blockKeys.has(vectorKey(position));
  }

  private settle(position: GridVector, gravity: GridVector): GridVector {
    let settled = cloneVector(position);
    let safety = this.level.size.x + this.level.size.y + this.level.size.z + 4;
    while (safety > 0) {
      const next = addVectors(settled, gravity);
      if (this.isSolid(next)) {
        return settled;
      }
      settled = next;
      safety -= 1;
    }
    return settled;
  }

  private getSurfaceNormal(position: GridVector): GridVector {
    const maximumX = this.level.size.x - 1;
    const maximumY = this.level.size.y - 1;
    const maximumZ = this.level.size.z - 1;
    if (position.x === 0) return { x: 1, y: 0, z: 0 };
    if (position.x === maximumX) return { x: -1, y: 0, z: 0 };
    if (position.y === 0) return { x: 0, y: 1, z: 0 };
    if (position.y === maximumY) return { x: 0, y: -1, z: 0 };
    if (position.z === 0) return { x: 0, y: 0, z: 1 };
    if (position.z === maximumZ) return { x: 0, y: 0, z: -1 };
    return { x: 0, y: 1, z: 0 };
  }

  private bindControls(): void {
    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
    window.addEventListener("blur", () => this.stopButtonRepeat());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clock.stop();
        this.stopButtonRepeat();
      } else {
        this.clock.start();
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", (event) => {
      const actionByCode: Partial<Record<string, GameAction>> = {
        ArrowUp: "move-up",
        KeyW: "move-up",
        ArrowDown: "move-down",
        KeyS: "move-down",
        ArrowLeft: "move-left",
        KeyA: "move-left",
        ArrowRight: "move-right",
        KeyD: "move-right",
        KeyI: "tilt-up",
        KeyK: "tilt-down",
        KeyJ: "tilt-left",
        KeyL: "tilt-right",
        KeyQ: "tilt-left",
        KeyE: "tilt-right",
        KeyZ: "undo",
        KeyU: "undo",
        KeyR: "reset",
        KeyM: "sound",
      };
      const action = actionByCode[event.code];
      if (action !== undefined) {
        event.preventDefault();
        if (!event.repeat || this.isMoveAction(action)) {
          this.handleAction(action);
        }
      }
    });

    document.querySelectorAll<HTMLElement>("[data-action]").forEach((control) => {
      control.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = control.dataset.action as GameAction | undefined;
        if (action === undefined) {
          return;
        }
        control.setPointerCapture(event.pointerId);
        this.startButtonAction(action);
      });
      ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"].forEach((eventName) => {
        control.addEventListener(eventName, () => this.stopButtonRepeat());
      });
    });

    this.canvas.addEventListener("pointerdown", (event) => this.beginGesture(event));
    this.canvas.addEventListener("pointermove", (event) => this.updateGesture(event));
    this.canvas.addEventListener("pointerup", (event) => this.endGesture(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelGesture());
  }

  private startButtonAction(action: GameAction): void {
    this.stopButtonRepeat();
    this.handleAction(action);
    if (!this.isMoveAction(action)) {
      return;
    }

    this.repeatDelayId = window.setTimeout(() => {
      this.repeatIntervalId = window.setInterval(() => this.handleAction(action), 145);
    }, 310);
  }

  private stopButtonRepeat(): void {
    if (this.repeatDelayId !== null) {
      window.clearTimeout(this.repeatDelayId);
      this.repeatDelayId = null;
    }
    if (this.repeatIntervalId !== null) {
      window.clearInterval(this.repeatIntervalId);
      this.repeatIntervalId = null;
    }
  }

  private beginGesture(event: PointerEvent): void {
    if (this.activeGesturePointers.size === 0) {
      this.gesturePoints.clear();
      this.gestureMaximumPointers = 0;
    }
    this.activeGesturePointers.add(event.pointerId);
    this.gesturePoints.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    });
    this.gestureMaximumPointers = Math.max(this.gestureMaximumPointers, this.activeGesturePointers.size);
    this.canvas.setPointerCapture(event.pointerId);
  }

  private updateGesture(event: PointerEvent): void {
    const point = this.gesturePoints.get(event.pointerId);
    if (point === undefined) {
      return;
    }
    point.currentX = event.clientX;
    point.currentY = event.clientY;
  }

  private endGesture(event: PointerEvent): void {
    const point = this.gesturePoints.get(event.pointerId);
    if (point !== undefined) {
      point.currentX = event.clientX;
      point.currentY = event.clientY;
    }
    this.activeGesturePointers.delete(event.pointerId);
    if (this.activeGesturePointers.size > 0) {
      return;
    }

    let totalDeltaX = 0;
    let totalDeltaY = 0;
    this.gesturePoints.forEach((gesturePoint) => {
      totalDeltaX += gesturePoint.currentX - gesturePoint.startX;
      totalDeltaY += gesturePoint.currentY - gesturePoint.startY;
    });
    const divisor = Math.max(this.gesturePoints.size, 1);
    const deltaX = totalDeltaX / divisor;
    const deltaY = totalDeltaY / divisor;
    const threshold = Math.max(26, Math.min(window.innerWidth, window.innerHeight) * 0.045);

    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= threshold) {
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
      if (this.gestureMaximumPointers >= 2) {
        const action: TiltAction = horizontal
          ? deltaX > 0
            ? "tilt-right"
            : "tilt-left"
          : deltaY > 0
            ? "tilt-down"
            : "tilt-up";
        this.handleAction(action);
      } else {
        const action: MoveAction = horizontal
          ? deltaX > 0
            ? "move-right"
            : "move-left"
          : deltaY > 0
            ? "move-down"
            : "move-up";
        this.handleAction(action);
      }
      this.hideGestureGuide();
    }

    this.gesturePoints.clear();
    this.gestureMaximumPointers = 0;
  }

  private cancelGesture(): void {
    this.activeGesturePointers.clear();
    this.gesturePoints.clear();
    this.gestureMaximumPointers = 0;
  }

  private handleAction(action: GameAction): void {
    this.ensureAudio();

    if (action === "sound") {
      this.toggleSound();
      return;
    }
    if (action === "reset" || action === "replay") {
      this.buildLevel(this.levelIndex);
      this.vibrate(18);
      return;
    }
    if (action === "next") {
      const nextIndex = this.levelIndex === LEVELS.length - 1 ? 0 : this.levelIndex + 1;
      this.buildLevel(nextIndex);
      this.vibrate(18);
      return;
    }
    if (action === "undo") {
      this.undo();
      return;
    }
    if (this.won) {
      return;
    }
    if (this.isBusy()) {
      this.queuedAction = action;
      return;
    }

    if (this.isTiltAction(action)) {
      this.tiltStage(action);
    } else {
      this.tryMove(action);
    }
  }

  private isMoveAction(action: GameAction): action is MoveAction {
    return action.startsWith("move-");
  }

  private isTiltAction(action: GameAction): action is TiltAction {
    return action.startsWith("tilt-");
  }

  private isBusy(): boolean {
    return this.motionAnimation !== null || this.rotationAnimation !== null || this.hazardTimeoutId !== null;
  }

  private tryMove(action: MoveAction): void {
    const direction = this.getScreenMovementDirection(action);
    const target = addVectors(this.playerCell, direction);
    if (this.isSolid(target)) {
      this.setHint("Blocked. Try another route or shift gravity.");
      this.spawnBurst(this.player.position.clone(), COLORS.hazard, 5);
      this.playSound("blocked");
      this.vibrate(24);
      return;
    }

    const destination = this.settle(target, this.gravity);
    this.pushSnapshot();
    this.moves += 1;
    this.lastFacing = direction;
    this.startMotion(destination, direction, "move");
    this.playSound("move");
    this.vibrate(8);
    this.advanceTutorial();
    this.updateHud();
  }

  private tiltStage(action: TiltAction): void {
    this.pushSnapshot();
    this.moves += 1;
    this.queuedAction = null;

    const axis = action === "tilt-left" || action === "tilt-right"
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);
    const direction = action === "tilt-left" || action === "tilt-up" ? 1 : -1;
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, direction * (Math.PI / 2));
    const target = turn.multiply(this.stageRoot.quaternion.clone()).normalize();

    this.rotationAnimation = {
      from: this.stageRoot.quaternion.clone(),
      to: target,
      elapsed: 0,
      duration: this.reducedMotion ? 0.12 : 0.46,
    };
    this.playSound("tilt");
    this.vibrate(28);
    this.setHint("Gravity shifting… brace for the fall.");
    this.advanceTutorial();
    this.updateHud();
  }

  private getScreenMovementDirection(action: MoveAction): GridVector {
    const forwardWorld = new THREE.Vector3();
    this.camera.getWorldDirection(forwardWorld);
    forwardWorld.y = 0;
    if (forwardWorld.lengthSq() < 0.001) {
      forwardWorld.set(0, 0, -1);
    }
    forwardWorld.normalize();
    const rightWorld = forwardWorld.clone().cross(WORLD_UP).normalize();

    const desiredWorld = action === "move-up"
      ? forwardWorld
      : action === "move-down"
        ? forwardWorld.clone().negate()
        : action === "move-right"
          ? rightWorld
          : rightWorld.clone().negate();

    const local = desiredWorld.applyQuaternion(this.stageRoot.quaternion.clone().invert());
    const candidates: Array<{ axis: "x" | "y" | "z"; value: number }> = [
      { axis: "x" as const, value: local.x },
      { axis: "y" as const, value: local.y },
      { axis: "z" as const, value: local.z },
    ].filter(({ axis }) => this.gravity[axis] === 0);
    candidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const primary = candidates[0];
    if (primary === undefined) {
      return this.getDefaultFacing(this.gravity);
    }

    return {
      x: primary.axis === "x" ? Math.sign(primary.value) : 0,
      y: primary.axis === "y" ? Math.sign(primary.value) : 0,
      z: primary.axis === "z" ? Math.sign(primary.value) : 0,
    };
  }

  private startMotion(destination: GridVector, facing: GridVector, kind: "move" | "fall"): void {
    const from = this.player.position.clone();
    const to = this.playerToLocal(destination);
    const distance = Math.max(gridDistance(this.playerCell, destination), 1);
    const duration = kind === "fall"
      ? Math.min(0.18 + distance * 0.085, 0.62)
      : Math.min(0.16 + distance * 0.07, 0.52);

    this.motionAnimation = {
      from,
      to,
      elapsed: 0,
      duration: this.reducedMotion ? Math.min(duration, 0.12) : duration,
      kind,
      destination,
      facing,
    };
    if (!vectorsEqual(facing, { x: 0, y: 0, z: 0 })) {
      this.orientPlayer(facing);
    }
  }

  private finishMotion(animation: MotionAnimation): void {
    this.player.position.copy(animation.to);
    this.playerCell = cloneVector(animation.destination);
    this.motionAnimation = null;
    this.orientPlayer(animation.facing);
    this.checkCurrentCell();
    if (this.hazardTimeoutId === null) {
      this.drainQueuedAction();
    }
  }

  private finishRotation(animation: RotationAnimation): void {
    this.stageRoot.quaternion.copy(animation.to).normalize();
    this.rotationAnimation = null;
    this.gravity = this.getLocalGravity();
    this.updateGravityHud();

    const destination = this.settle(this.playerCell, this.gravity);
    const facing = this.projectFacingToSurface(this.lastFacing, this.gravity);
    this.lastFacing = facing;
    if (vectorsEqual(destination, this.playerCell)) {
      this.player.position.copy(this.playerToLocal(this.playerCell));
      this.orientPlayer(facing);
      this.checkCurrentCell();
      this.flash("rgba(255,255,255,0.72)");
      this.playSound("land");
      this.drainQueuedAction();
      return;
    }

    this.startMotion(destination, facing, "fall");
  }

  private getLocalGravity(): GridVector {
    const localDown = WORLD_DOWN.clone().applyQuaternion(this.stageRoot.quaternion.clone().invert());
    const values = [
      { axis: "x" as const, value: localDown.x },
      { axis: "y" as const, value: localDown.y },
      { axis: "z" as const, value: localDown.z },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const primary = values[0];
    if (primary === undefined) {
      return { x: 0, y: -1, z: 0 };
    }
    return {
      x: primary.axis === "x" ? Math.sign(primary.value) : 0,
      y: primary.axis === "y" ? Math.sign(primary.value) : 0,
      z: primary.axis === "z" ? Math.sign(primary.value) : 0,
    };
  }

  private projectFacingToSurface(facing: GridVector, gravity: GridVector): GridVector {
    if (facing.x * gravity.x + facing.y * gravity.y + facing.z * gravity.z === 0) {
      return cloneVector(facing);
    }
    return this.getDefaultFacing(gravity);
  }

  private getDefaultFacing(gravity: GridVector): GridVector {
    if (gravity.y !== 0) {
      return { x: 0, y: 0, z: 1 };
    }
    if (gravity.z !== 0) {
      return { x: 1, y: 0, z: 0 };
    }
    return { x: 0, y: 0, z: 1 };
  }

  private orientPlayer(facing: GridVector): void {
    const up = new THREE.Vector3(-this.gravity.x, -this.gravity.y, -this.gravity.z).normalize();
    let forward = new THREE.Vector3(facing.x, facing.y, facing.z);
    forward.addScaledVector(up, -forward.dot(up));
    if (forward.lengthSq() < 0.1) {
      const fallback = this.getDefaultFacing(this.gravity);
      forward.set(fallback.x, fallback.y, fallback.z);
    }
    forward.normalize();
    const right = up.clone().cross(forward).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, forward);
    this.player.quaternion.setFromRotationMatrix(basis);
  }

  private checkCurrentCell(): void {
    const cellKey = vectorKey(this.playerCell);
    if (this.hazardKeys.has(cellKey)) {
      this.triggerHazard();
      return;
    }

    const crystal = this.crystalMeshes.get(cellKey);
    if (crystal !== undefined && !this.collectedCrystalKeys.has(cellKey)) {
      this.collectedCrystalKeys.add(cellKey);
      crystal.visible = false;
      this.spawnBurst(crystal.position.clone(), COLORS.crystal, 18);
      this.playSound("collect");
      this.vibrate([20, 35, 20]);
      const remaining = this.level.crystals.length - this.collectedCrystalKeys.size;
      this.setHint(remaining === 0 ? "Portal unlocked! Reach the violet gate." : `${remaining} shard${remaining === 1 ? "" : "s"} remaining.`);
      this.updateHud();
    }

    if (vectorsEqual(this.playerCell, this.level.goal)) {
      if (this.collectedCrystalKeys.size === this.level.crystals.length) {
        this.completeLevel();
      } else {
        this.setHint("The portal is dormant. Restore every shard first.");
        this.playSound("blocked");
      }
    }
  }

  private triggerHazard(): void {
    this.queuedAction = null;
    this.setHint("Energy overload! Rewinding to safety…");
    this.flash("rgba(255,65,91,0.48)");
    this.spawnBurst(this.player.position.clone(), COLORS.hazard, 22);
    this.playSound("hazard");
    this.vibrate([45, 35, 60]);
    this.hazardTimeoutId = window.setTimeout(() => {
      this.hazardTimeoutId = null;
      this.undo(false);
    }, this.reducedMotion ? 80 : 380);
  }

  private pushSnapshot(): void {
    const quaternion = this.stageRoot.quaternion;
    this.history.push({
      playerCell: cloneVector(this.playerCell),
      gravity: cloneVector(this.gravity),
      stageQuaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      collected: [...this.collectedCrystalKeys],
      moves: this.moves,
    });
    if (this.history.length > 40) {
      this.history.shift();
    }
    this.updateUndoButton();
  }

  private undo(withFeedback = true): void {
    if (this.isBusy() && this.hazardTimeoutId === null) {
      return;
    }
    const snapshot = this.history.pop();
    if (snapshot === undefined) {
      if (withFeedback) {
        this.setHint("Nothing to undo yet.");
        this.playSound("blocked");
      }
      return;
    }

    this.motionAnimation = null;
    this.rotationAnimation = null;
    this.queuedAction = null;
    this.won = false;
    this.resultPanel.hidden = true;
    this.playerCell = cloneVector(snapshot.playerCell);
    this.gravity = cloneVector(snapshot.gravity);
    this.moves = snapshot.moves;
    this.stageRoot.quaternion.set(...snapshot.stageQuaternion).normalize();
    this.player.position.copy(this.playerToLocal(this.playerCell));
    this.lastFacing = this.projectFacingToSurface(this.lastFacing, this.gravity);
    this.orientPlayer(this.lastFacing);
    this.collectedCrystalKeys.clear();
    snapshot.collected.forEach((key) => this.collectedCrystalKeys.add(key));
    this.crystalMeshes.forEach((mesh, key) => {
      mesh.visible = !this.collectedCrystalKeys.has(key);
    });
    this.updateGravityHud();
    this.updateHud();
    this.setHint(withFeedback ? "Last action undone." : "Back to safety.");
    if (withFeedback) {
      this.playSound("undo");
      this.vibrate(14);
    }
    this.updateUndoButton();
  }

  private drainQueuedAction(): void {
    if (this.isBusy() || this.won) {
      return;
    }
    const action = this.queuedAction;
    this.queuedAction = null;
    if (action !== null) {
      window.setTimeout(() => this.handleAction(action), 0);
    }
  }

  private completeLevel(): void {
    this.won = true;
    this.queuedAction = null;
    const previousBest = this.bestScores[this.level.id];
    const newBest = previousBest === undefined ? this.moves : Math.min(previousBest, this.moves);
    this.bestScores[this.level.id] = newBest;
    window.localStorage.setItem(STORAGE_BEST, JSON.stringify(this.bestScores));

    const stars = this.moves <= this.level.parMoves ? 3 : this.moves <= this.level.parMoves + 5 ? 2 : 1;
    this.resultStars.textContent = `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`;
    this.resultStars.dataset.stars = String(stars);
    this.resultTitle.textContent = stars === 3 ? "Perfect orbit!" : stars === 2 ? "Chamber restored!" : "Gravity mastered!";
    this.resultSummary.textContent = `Every shard in ${this.level.name} is stable again.`;
    this.resultMoves.textContent = String(this.moves);
    this.resultPar.textContent = String(this.level.parMoves);
    this.resultBest.textContent = String(newBest);
    this.spawnBurst(this.player.position.clone(), COLORS.portalOpen, 34);
    this.playSound("win");
    this.vibrate([35, 45, 35, 45, 70]);
    this.flash("rgba(168,140,255,0.42)");
    this.updateHud();

    window.setTimeout(() => {
      this.resultPanel.hidden = false;
    }, this.reducedMotion ? 80 : 520);
  }

  private spawnBurst(origin: THREE.Vector3, color: number, amount: number): void {
    for (let index = 0; index < amount; index += 1) {
      const geometry = new THREE.TetrahedronGeometry(0.045 + Math.random() * 0.055, 0);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(origin);
      this.chamberGroup.add(mesh);

      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.15,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(1.2 + Math.random() * 1.8);

      this.particles.push({
        mesh,
        velocity: direction,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
      });
    }
  }

  private update(delta: number, elapsed: number): void {
    this.monitorPerformance(delta);

    if (this.motionAnimation !== null) {
      const animation = this.motionAnimation;
      animation.elapsed += delta;
      const progress = Math.min(animation.elapsed / animation.duration, 1);
      const eased = animation.kind === "fall" ? easeOutBack(progress) : easeInOutCubic(progress);
      this.player.position.lerpVectors(animation.from, animation.to, eased);
      if (animation.kind === "move") {
        const up = new THREE.Vector3(-this.gravity.x, -this.gravity.y, -this.gravity.z);
        this.player.position.addScaledVector(up, Math.sin(progress * Math.PI) * 0.12);
      }
      const gait = Math.sin(progress * Math.PI * 2) * 0.35;
      this.animatePlayerLimbs(gait);

      if (progress >= 1) {
        this.animatePlayerLimbs(0);
        this.finishMotion(animation);
        this.playSound("land");
        this.flash("rgba(255,255,255,0.32)");
      }
    } else {
      const localUp = new THREE.Vector3(-this.gravity.x, -this.gravity.y, -this.gravity.z);
      this.player.position.copy(this.playerToLocal(this.playerCell)).addScaledVector(localUp, Math.sin(elapsed * 3.1) * 0.018);
      this.animatePlayerLimbs(Math.sin(elapsed * 2.2) * 0.035);
    }

    if (this.rotationAnimation !== null) {
      const animation = this.rotationAnimation;
      animation.elapsed += delta;
      const progress = Math.min(animation.elapsed / animation.duration, 1);
      this.stageRoot.quaternion.slerpQuaternions(animation.from, animation.to, easeInOutCubic(progress));
      const pulse = 1 - Math.sin(progress * Math.PI) * 0.035;
      this.stageRoot.scale.setScalar(pulse);
      if (progress >= 1) {
        this.stageRoot.scale.setScalar(1);
        this.finishRotation(animation);
      }
    }

    this.crystalMeshes.forEach((crystal) => {
      const phase = Number(crystal.userData.phase ?? 0);
      crystal.rotation.y = elapsed * 1.65 + phase;
      crystal.rotation.x = Math.sin(elapsed * 1.1 + phase) * 0.18;
      const pulse = 1 + Math.sin(elapsed * 3 + phase) * 0.08;
      crystal.scale.setScalar(pulse);
    });

    this.hazardMeshes.forEach((hazard) => {
      const phase = Number(hazard.userData.phase ?? 0);
      const pulse = 0.92 + Math.sin(elapsed * 4.4 + phase) * 0.08;
      hazard.scale.setScalar(pulse);
      hazard.rotation.y = Math.sin(elapsed * 1.8 + phase) * 0.25;
    });

    const portalOpen = this.collectedCrystalKeys.size === this.level.crystals.length;
    const portalColor = portalOpen ? COLORS.portalOpen : COLORS.portalLocked;
    this.portalRing.material.color.setHex(portalColor);
    this.portalRing.material.emissive.setHex(portalColor);
    this.portalRing.material.emissiveIntensity = portalOpen ? 1.65 : 0.3;
    this.portalCore.material.color.setHex(portalColor);
    this.portalCore.material.opacity = portalOpen ? 0.35 + Math.sin(elapsed * 4) * 0.08 : 0.07;
    this.portalRing.rotation.z = elapsed * (portalOpen ? 1.25 : 0.28);
    const portalPulse = portalOpen ? 1 + Math.sin(elapsed * 4) * 0.07 : 1;
    this.portalRing.scale.setScalar(portalPulse);
    this.portalLight.color.setHex(portalColor);
    this.portalLight.intensity = portalOpen ? 2.1 + Math.sin(elapsed * 4) * 0.45 : 0;

    this.chamberGroup.children.forEach((child) => {
      if (child.userData.isChamberCore === true) {
        child.rotation.x = elapsed * 0.45;
        child.rotation.y = elapsed * 0.7;
      }
    });

    this.updateParticles(delta);
  }

  private animatePlayerLimbs(value: number): void {
    const leftLeg = this.player.userData.leftLeg as THREE.Mesh | undefined;
    const rightLeg = this.player.userData.rightLeg as THREE.Mesh | undefined;
    const leftArm = this.player.userData.leftArm as THREE.Mesh | undefined;
    const rightArm = this.player.userData.rightArm as THREE.Mesh | undefined;
    if (leftLeg !== undefined) leftLeg.rotation.x = value;
    if (rightLeg !== undefined) rightLeg.rotation.x = -value;
    if (leftArm !== undefined) leftArm.rotation.x = -value * 0.8;
    if (rightArm !== undefined) rightArm.rotation.x = value * 0.8;
  }

  private updateParticles(delta: number): void {
    const gravityVector = new THREE.Vector3(this.gravity.x, this.gravity.y, this.gravity.z);
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }
      particle.life -= delta;
      particle.velocity.addScaledVector(gravityVector, 2.4 * delta);
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += delta * 5;
      particle.mesh.rotation.y += delta * 7;
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(particle.life / particle.maxLife, 0);

      if (particle.life <= 0) {
        this.chamberGroup.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        material.dispose();
        this.particles.splice(index, 1);
      }
    }
  }

  private monitorPerformance(delta: number): void {
    if (this.qualityAdjusted || delta <= 0 || delta > 0.1) {
      return;
    }
    this.frameSampleTotal += delta;
    this.frameSampleCount += 1;
    if (this.frameSampleCount < 150) {
      return;
    }
    const average = this.frameSampleTotal / this.frameSampleCount;
    if (average > 0.024 && this.targetPixelRatio > 1) {
      this.targetPixelRatio = 1;
      this.renderer.setPixelRatio(this.targetPixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    this.qualityAdjusted = true;
  }

  private updateHud(): void {
    this.levelNumberElement.textContent = `CHAMBER ${String(this.levelIndex + 1).padStart(2, "0")}`;
    this.levelNameElement.textContent = this.level.name;
    this.levelSubtitleElement.textContent = this.level.subtitle;
    this.crystalCountElement.textContent = `${this.collectedCrystalKeys.size} / ${this.level.crystals.length}`;
    this.moveCountElement.textContent = String(this.moves);
    const best = this.bestScores[this.level.id];
    this.bestCountElement.textContent = best === undefined ? "—" : String(best);
    this.updateUndoButton();
  }

  private updateUndoButton(): void {
    const undoButton = document.querySelector<HTMLButtonElement>('button[data-action="undo"]');
    if (undoButton !== null) {
      undoButton.disabled = this.history.length === 0;
    }
  }

  private updateGravityHud(): void {
    const key = vectorKey(this.gravity);
    const labels: Record<string, { label: string; icon: string }> = {
      "0:-1:0": { label: "FLOOR", icon: "↓" },
      "0:1:0": { label: "CEILING", icon: "↑" },
      "-1:0:0": { label: "LEFT WALL", icon: "←" },
      "1:0:0": { label: "RIGHT WALL", icon: "→" },
      "0:0:-1": { label: "FRONT WALL", icon: "↙" },
      "0:0:1": { label: "BACK WALL", icon: "↗" },
    };
    const state = labels[key] ?? { label: "SHIFTED", icon: "◆" };
    this.gravityLabelElement.textContent = state.label;
    this.gravityIconElement.textContent = state.icon;
  }

  private showTutorialHint(): void {
    const message = this.level.tutorial[this.tutorialIndex] ?? this.level.subtitle;
    this.setHint(message);
  }

  private advanceTutorial(): void {
    if (this.tutorialIndex >= this.level.tutorial.length - 1) {
      return;
    }
    this.tutorialIndex += 1;
    const message = this.level.tutorial[this.tutorialIndex];
    if (message !== undefined) {
      window.setTimeout(() => this.setHint(message), 250);
    }
  }

  private setHint(message: string): void {
    this.hintElement.textContent = message;
    this.hintElement.classList.remove("hint--pulse");
    window.requestAnimationFrame(() => this.hintElement.classList.add("hint--pulse"));
  }

  private showGestureGuide(): void {
    if (!this.coarsePointer || this.levelIndex !== 0) {
      this.gestureGuideElement.classList.remove("gesture-guide--visible");
      return;
    }
    this.gestureGuideElement.classList.add("gesture-guide--visible");
    if (this.guideTimeoutId !== null) {
      window.clearTimeout(this.guideTimeoutId);
    }
    this.guideTimeoutId = window.setTimeout(() => this.hideGestureGuide(), 6500);
  }

  private hideGestureGuide(): void {
    this.gestureGuideElement.classList.remove("gesture-guide--visible");
    if (this.guideTimeoutId !== null) {
      window.clearTimeout(this.guideTimeoutId);
      this.guideTimeoutId = null;
    }
  }

  private flash(color: string): void {
    this.impactFlashElement.style.background = color;
    this.impactFlashElement.classList.remove("impact-flash--show");
    window.requestAnimationFrame(() => this.impactFlashElement.classList.add("impact-flash--show"));
  }

  private ensureAudio(): void {
    if (this.muted) {
      return;
    }
    if (this.audioContext === null) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }
  }

  private toggleSound(): void {
    this.muted = !this.muted;
    window.localStorage.setItem(STORAGE_MUTED, String(this.muted));
    if (!this.muted) {
      this.ensureAudio();
      this.playTone(620, 0.08, "sine", 0.06);
    }
    this.updateSoundHud();
    this.setHint(this.muted ? "Sound muted." : "Sound enabled.");
  }

  private updateSoundHud(): void {
    this.soundIconElement.textContent = this.muted ? "×" : "♪";
    this.soundLabelElement.textContent = this.muted ? "MUTED" : "SOUND";
  }

  private playSound(kind: "move" | "land" | "tilt" | "collect" | "blocked" | "hazard" | "undo" | "win"): void {
    if (this.muted) {
      return;
    }
    this.ensureAudio();
    if (kind === "move") this.playTone(245, 0.055, "triangle", 0.025);
    if (kind === "land") this.playTone(150, 0.07, "sine", 0.025);
    if (kind === "tilt") {
      this.playTone(190, 0.18, "sawtooth", 0.018);
      this.playTone(310, 0.16, "triangle", 0.018, 0.08);
    }
    if (kind === "collect") {
      this.playTone(660, 0.12, "sine", 0.055);
      this.playTone(880, 0.14, "sine", 0.05, 0.08);
      this.playTone(1180, 0.17, "sine", 0.045, 0.16);
    }
    if (kind === "blocked") this.playTone(115, 0.11, "square", 0.03);
    if (kind === "hazard") {
      this.playTone(150, 0.2, "sawtooth", 0.05);
      this.playTone(82, 0.3, "square", 0.035, 0.08);
    }
    if (kind === "undo") this.playTone(420, 0.12, "triangle", 0.035);
    if (kind === "win") {
      [523, 659, 784, 1047].forEach((frequency, index) => {
        this.playTone(frequency, 0.22, "sine", 0.05, index * 0.11);
      });
    }
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ): void {
    const context = this.audioContext;
    if (context === null || this.muted) {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private vibrate(pattern: number | number[]): void {
    if (this.coarsePointer && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }

  private resize(): void {
    const width = window.visualViewport?.width ?? window.innerWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const chamberSize = Math.max(this.level.size.x, this.level.size.y, this.level.size.z);
    const portrait = height > width;
    const compactLandscape = height < 650 && width > height;
    const distance = chamberSize * (portrait ? 2.15 : compactLandscape ? 1.62 : 1.78);
    this.camera.position.set(distance * 0.82, distance * 0.7, distance);
    this.camera.lookAt(0, portrait ? -0.25 : 0, 0);

    this.renderer.setPixelRatio(this.targetPixelRatio);
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    window.requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.update(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
  };
}

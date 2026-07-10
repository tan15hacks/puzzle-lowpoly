import * as THREE from "three";
import { LEVEL_ONE, type GridPosition, type LevelDefinition } from "./levels";

type MoveDirection = "up" | "down" | "left" | "right";
type GameAction = MoveDirection | "rotate-left" | "rotate-right" | "reset";

type MoveAnimation = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  elapsed: number;
  duration: number;
  direction: GridPosition;
  targetGrid: GridPosition;
};

type RotationAnimation = {
  from: number;
  to: number;
  elapsed: number;
  duration: number;
};

type BurstParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
};

const COLORS = {
  sky: 0x8fd3ff,
  fog: 0xbfe8ff,
  grass: 0x8ed081,
  grassAlt: 0xa8dc8e,
  soil: 0x8a6a4b,
  stone: 0xf3f0e7,
  stoneSide: 0xcfcac0,
  player: 0xffc857,
  playerDark: 0x3e4a61,
  crystal: 0x68f7ff,
  portalLocked: 0x6f7894,
  portalOpen: 0x9a6bff,
  danger: 0xff6b6b,
} as const;

const easeInOutCubic = (value: number): number =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

const keyForPosition = ({ x, z }: GridPosition): string => `${x}:${z}`;

const getRequiredElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Required UI element #${id} was not found.`);
  }
  return element as T;
};

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly clock = new THREE.Clock();
  private readonly stageRoot = new THREE.Group();
  private readonly boardGroup = new THREE.Group();
  private readonly crystalMeshes = new Map<string, THREE.Mesh>();
  private readonly particles: BurstParticle[] = [];
  private readonly level: LevelDefinition = LEVEL_ONE;

  private readonly crystalCountElement = getRequiredElement<HTMLElement>("crystal-count");
  private readonly moveCountElement = getRequiredElement<HTMLElement>("move-count");
  private readonly hintElement = getRequiredElement<HTMLElement>("hint");
  private readonly resultPanel = getRequiredElement<HTMLElement>("result-panel");
  private readonly resultSummary = getRequiredElement<HTMLElement>("result-summary");

  private player = new THREE.Group();
  private portalRing = new THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>();
  private portalLight = new THREE.PointLight(COLORS.portalLocked, 0, 4);
  private playerGrid: GridPosition = { ...LEVEL_ONE.start };
  private moveAnimation: MoveAnimation | null = null;
  private rotationAnimation: RotationAnimation | null = null;
  private boardQuarterTurns = 0;
  private collectedCrystals = 0;
  private moves = 0;
  private won = false;
  private pointerStart: { x: number; y: number } | null = null;

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
    this.buildLevel();
    this.bindControls();
    this.resize();
    this.animate();
  }

  private configureRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.fog, 18, 38);

    this.camera.position.set(11, 13, 13);
    this.camera.lookAt(0, 0, 0);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x56706d, 2.2);
    this.scene.add(hemisphereLight);

    const sun = new THREE.DirectionalLight(0xfff2d2, 3.2);
    sun.position.set(8, 15, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 35;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.stageRoot.add(this.boardGroup);
    this.scene.add(this.stageRoot);
  }

  private buildEnvironment(): void {
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true,
    });
    const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);

    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2;
      const radius = 12 + (index % 4) * 2.3;
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(
        Math.cos(angle) * radius,
        -4.5 + (index % 3) * 1.3,
        Math.sin(angle) * radius,
      );
      cloud.scale.set(2.1 + (index % 3), 0.65 + (index % 2) * 0.25, 1.4 + (index % 4) * 0.35);
      cloud.rotation.set(index * 0.3, angle, index * 0.17);
      cloud.receiveShadow = true;
      this.scene.add(cloud);
    }

    const islandGeometry = new THREE.ConeGeometry(1.5, 3, 5);
    const islandMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.soil,
      roughness: 1,
      flatShading: true,
    });

    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2 + 0.35;
      const island = new THREE.Mesh(islandGeometry, islandMaterial);
      island.position.set(Math.cos(angle) * 16, -4 - (index % 2), Math.sin(angle) * 16);
      island.rotation.z = Math.PI;
      island.rotation.y = angle;
      island.scale.setScalar(0.8 + (index % 3) * 0.28);
      island.castShadow = true;
      this.scene.add(island);
    }
  }

  private buildLevel(): void {
    this.clearBoard();

    const tileGeometry = new THREE.BoxGeometry(0.94, 0.38, 0.94);
    const grassMaterials = [
      new THREE.MeshStandardMaterial({ color: COLORS.grass, roughness: 0.9, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: COLORS.grassAlt, roughness: 0.9, flatShading: true }),
    ];
    const wallGeometry = new THREE.BoxGeometry(0.9, 1.35, 0.9);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.stone,
      roughness: 0.84,
      flatShading: true,
    });

    this.level.map.forEach((row, z) => {
      [...row].forEach((cell, x) => {
        const tile = new THREE.Mesh(tileGeometry, grassMaterials[(x + z) % 2]);
        tile.position.copy(this.gridToLocal({ x, z }, -0.22));
        tile.castShadow = true;
        tile.receiveShadow = true;
        this.boardGroup.add(tile);

        if (cell === "#") {
          const wall = new THREE.Mesh(wallGeometry, wallMaterial);
          wall.position.copy(this.gridToLocal({ x, z }, 0.62));
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.boardGroup.add(wall);
        }
      });
    });

    this.addIslandUnderside();

    this.player = this.createPlayer();
    this.player.position.copy(this.gridToLocal(this.level.start, 0.03));
    this.boardGroup.add(this.player);

    this.level.crystals.forEach((position) => {
      const crystal = this.createCrystal();
      crystal.position.copy(this.gridToLocal(position, 0.75));
      this.crystalMeshes.set(keyForPosition(position), crystal);
      this.boardGroup.add(crystal);
    });

    this.createPortal();
    this.playerGrid = { ...this.level.start };
    this.collectedCrystals = 0;
    this.moves = 0;
    this.won = false;
    this.boardQuarterTurns = 0;
    this.stageRoot.rotation.y = 0;
    this.boardGroup.rotation.set(0, 0, 0);
    this.resultPanel.hidden = true;
    this.setHint("Collect every energy crystal, then enter the portal.");
    this.updateHud();
  }

  private clearBoard(): void {
    this.boardGroup.clear();
    this.crystalMeshes.clear();
    this.particles.splice(0, this.particles.length);
    this.moveAnimation = null;
    this.rotationAnimation = null;
  }

  private addIslandUnderside(): void {
    const width = this.level.map[0]?.length ?? 0;
    const depth = this.level.map.length;
    const undersideGeometry = new THREE.CylinderGeometry(
      Math.max(width, depth) * 0.55,
      1.8,
      4.7,
      8,
      1,
      false,
    );
    const undersideMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.soil,
      roughness: 1,
      flatShading: true,
    });
    const underside = new THREE.Mesh(undersideGeometry, undersideMaterial);
    underside.position.y = -2.75;
    underside.castShadow = true;
    underside.receiveShadow = true;
    this.boardGroup.add(underside);
  }

  private createPlayer(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.player,
      roughness: 0.7,
      flatShading: true,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.playerDark,
      roughness: 0.76,
      flatShading: true,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.36), bodyMaterial);
    body.position.y = 0.55;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.42), bodyMaterial);
    head.position.y = 1.02;

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.035), darkMaterial);
    visor.position.set(0, 1.03, 0.225);

    const legGeometry = new THREE.BoxGeometry(0.16, 0.36, 0.18);
    const leftLeg = new THREE.Mesh(legGeometry, darkMaterial);
    leftLeg.position.set(-0.14, 0.18, 0);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.14;

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 6), darkMaterial);
    antenna.position.y = 1.35;
    const antennaTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), bodyMaterial);
    antennaTip.position.y = 1.5;

    [body, head, visor, leftLeg, rightLeg, antenna, antennaTip].forEach((part) => {
      part.castShadow = true;
      part.receiveShadow = true;
      group.add(part);
    });

    return group;
  }

  private createCrystal(): THREE.Mesh {
    const geometry = new THREE.OctahedronGeometry(0.3, 0);
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.crystal,
      emissive: COLORS.crystal,
      emissiveIntensity: 1.25,
      roughness: 0.25,
      metalness: 0.08,
      flatShading: true,
    });
    const crystal = new THREE.Mesh(geometry, material);
    crystal.castShadow = true;
    crystal.userData.baseY = crystal.position.y;
    return crystal;
  }

  private createPortal(): void {
    const portalGroup = new THREE.Group();
    portalGroup.position.copy(this.gridToLocal(this.level.goal, 0.78));

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.56, 0.24, 8),
      new THREE.MeshStandardMaterial({ color: COLORS.stoneSide, roughness: 0.86, flatShading: true }),
    );
    pedestal.position.y = -0.67;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;

    const portalMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.portalLocked,
      emissive: COLORS.portalLocked,
      emissiveIntensity: 0.35,
      roughness: 0.34,
      metalness: 0.25,
    });
    this.portalRing = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.1, 8, 20), portalMaterial);
    this.portalRing.castShadow = true;

    this.portalLight = new THREE.PointLight(COLORS.portalLocked, 0, 4);
    this.portalLight.position.z = 0.25;

    portalGroup.add(pedestal, this.portalRing, this.portalLight);
    this.boardGroup.add(portalGroup);
  }

  private gridToLocal(position: GridPosition, y = 0): THREE.Vector3 {
    const width = this.level.map[0]?.length ?? 0;
    const depth = this.level.map.length;
    return new THREE.Vector3(position.x - (width - 1) / 2, y, position.z - (depth - 1) / 2);
  }

  private bindControls(): void {
    window.addEventListener("resize", () => this.resize());

    window.addEventListener("keydown", (event) => {
      const actionByKey: Partial<Record<string, GameAction>> = {
        ArrowUp: "up",
        w: "up",
        W: "up",
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right",
        q: "rotate-left",
        Q: "rotate-left",
        e: "rotate-right",
        E: "rotate-right",
        r: "reset",
        R: "reset",
      };
      const action = actionByKey[event.key];
      if (action !== undefined) {
        event.preventDefault();
        this.handleAction(action);
      }
    });

    document.querySelectorAll<HTMLElement>("[data-action]").forEach((control) => {
      control.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const action = control.dataset.action as GameAction | undefined;
        if (action !== undefined) {
          this.handleAction(action);
        }
      });
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });

    this.canvas.addEventListener("pointerup", (event) => {
      if (this.pointerStart === null) {
        return;
      }

      const deltaX = event.clientX - this.pointerStart.x;
      const deltaY = event.clientY - this.pointerStart.y;
      this.pointerStart = null;

      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 28) {
        return;
      }

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.handleAction(deltaX > 0 ? "right" : "left");
      } else {
        this.handleAction(deltaY > 0 ? "down" : "up");
      }
    });

    this.canvas.addEventListener("pointercancel", () => {
      this.pointerStart = null;
    });
  }

  private handleAction(action: GameAction): void {
    if (action === "reset") {
      this.buildLevel();
      return;
    }

    if (this.won || this.moveAnimation !== null || this.rotationAnimation !== null) {
      return;
    }

    if (action === "rotate-left" || action === "rotate-right") {
      this.rotateStage(action === "rotate-right" ? 1 : -1);
      return;
    }

    this.tryMove(action);
  }

  private rotateStage(direction: -1 | 1): void {
    const from = this.stageRoot.rotation.y;
    const to = from + direction * (Math.PI / 2);
    this.rotationAnimation = { from, to, elapsed: 0, duration: 0.42 };
    this.boardQuarterTurns = (this.boardQuarterTurns + direction + 4) % 4;
    this.setHint("The stage changed orientation. Movement follows the screen.");
  }

  private tryMove(direction: MoveDirection): void {
    const screenDirections: Record<MoveDirection, GridPosition> = {
      up: { x: 0, z: -1 },
      down: { x: 0, z: 1 },
      left: { x: -1, z: 0 },
      right: { x: 1, z: 0 },
    };
    const localDirection = this.screenDirectionToBoard(screenDirections[direction]);
    const targetGrid = {
      x: this.playerGrid.x + localDirection.x,
      z: this.playerGrid.z + localDirection.z,
    };

    if (!this.isWalkable(targetGrid)) {
      this.setHint("That path is blocked.");
      this.spawnBurst(this.player.position.clone().add(new THREE.Vector3(0, 0.65, 0)), COLORS.danger, 5);
      return;
    }

    this.player.rotation.y = Math.atan2(localDirection.x, localDirection.z);
    this.moveAnimation = {
      from: this.player.position.clone(),
      to: this.gridToLocal(targetGrid, 0.03),
      elapsed: 0,
      duration: 0.2,
      direction: localDirection,
      targetGrid,
    };
    this.moves += 1;
    this.updateHud();
  }

  private screenDirectionToBoard(screenDirection: GridPosition): GridPosition {
    const angle = this.boardQuarterTurns * (Math.PI / 2);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
      x: Math.round(cosine * screenDirection.x - sine * screenDirection.z),
      z: Math.round(sine * screenDirection.x + cosine * screenDirection.z),
    };
  }

  private isWalkable(position: GridPosition): boolean {
    const row = this.level.map[position.z];
    const cell = row?.[position.x];
    return cell !== undefined && cell !== "#";
  }

  private finishMove(animation: MoveAnimation): void {
    this.player.position.copy(animation.to);
    this.playerGrid = { ...animation.targetGrid };
    this.moveAnimation = null;
    this.boardGroup.rotation.x = 0;
    this.boardGroup.rotation.z = 0;

    const positionKey = keyForPosition(this.playerGrid);
    const crystal = this.crystalMeshes.get(positionKey);
    if (crystal !== undefined) {
      const burstPosition = crystal.position.clone();
      this.boardGroup.remove(crystal);
      this.crystalMeshes.delete(positionKey);
      this.collectedCrystals += 1;
      this.spawnBurst(burstPosition, COLORS.crystal, 14);
      this.updateHud();
      this.setHint(
        this.collectedCrystals === this.level.crystals.length
          ? "Portal unlocked! Find the glowing exit."
          : `${this.level.crystals.length - this.collectedCrystals} energy crystal${
              this.level.crystals.length - this.collectedCrystals === 1 ? "" : "s"
            } remaining.`,
      );
    }

    if (this.playerGrid.x === this.level.goal.x && this.playerGrid.z === this.level.goal.z) {
      if (this.collectedCrystals === this.level.crystals.length) {
        this.completeLevel();
      } else {
        this.setHint("The portal needs every energy crystal.");
      }
    }
  }

  private completeLevel(): void {
    this.won = true;
    this.spawnBurst(this.player.position.clone().add(new THREE.Vector3(0, 0.8, 0)), COLORS.portalOpen, 28);
    this.resultSummary.textContent = `You restored ${this.level.name} in ${this.moves} moves.`;
    window.setTimeout(() => {
      this.resultPanel.hidden = false;
    }, 450);
  }

  private spawnBurst(origin: THREE.Vector3, color: number, amount: number): void {
    for (let index = 0; index < amount; index += 1) {
      const geometry = new THREE.TetrahedronGeometry(0.055 + Math.random() * 0.055, 0);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(origin);
      this.boardGroup.add(mesh);

      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        0.45 + Math.random() * 0.65,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(1.4 + Math.random() * 1.8);

      this.particles.push({
        mesh,
        velocity: direction,
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
      });
    }
  }

  private update(delta: number, elapsed: number): void {
    if (this.moveAnimation !== null) {
      const animation = this.moveAnimation;
      animation.elapsed += delta;
      const progress = Math.min(animation.elapsed / animation.duration, 1);
      const eased = easeInOutCubic(progress);
      this.player.position.lerpVectors(animation.from, animation.to, eased);
      this.player.position.y += Math.sin(progress * Math.PI) * 0.18;
      this.boardGroup.rotation.x = -animation.direction.z * Math.sin(progress * Math.PI) * 0.055;
      this.boardGroup.rotation.z = animation.direction.x * Math.sin(progress * Math.PI) * 0.055;

      if (progress >= 1) {
        this.finishMove(animation);
      }
    } else {
      this.player.position.y = 0.03 + Math.sin(elapsed * 3.1) * 0.025;
    }

    if (this.rotationAnimation !== null) {
      const animation = this.rotationAnimation;
      animation.elapsed += delta;
      const progress = Math.min(animation.elapsed / animation.duration, 1);
      this.stageRoot.rotation.y = THREE.MathUtils.lerp(animation.from, animation.to, easeInOutCubic(progress));
      if (progress >= 1) {
        this.stageRoot.rotation.y = animation.to;
        this.rotationAnimation = null;
      }
    }

    this.crystalMeshes.forEach((crystal, key) => {
      const [xText, zText] = key.split(":");
      const phase = Number(xText) * 0.7 + Number(zText) * 0.4;
      crystal.rotation.y = elapsed * 1.8 + phase;
      crystal.position.y = 0.75 + Math.sin(elapsed * 2.4 + phase) * 0.09;
    });

    const portalOpen = this.collectedCrystals === this.level.crystals.length;
    const portalColor = portalOpen ? COLORS.portalOpen : COLORS.portalLocked;
    this.portalRing.material.color.setHex(portalColor);
    this.portalRing.material.emissive.setHex(portalColor);
    this.portalRing.material.emissiveIntensity = portalOpen ? 1.7 : 0.3;
    this.portalRing.rotation.z = elapsed * (portalOpen ? 1.35 : 0.35);
    const portalPulse = portalOpen ? 1 + Math.sin(elapsed * 4) * 0.08 : 1;
    this.portalRing.scale.setScalar(portalPulse);
    this.portalLight.color.setHex(portalColor);
    this.portalLight.intensity = portalOpen ? 2.2 + Math.sin(elapsed * 4) * 0.5 : 0;

    this.updateParticles(delta);
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }

      particle.life -= delta;
      particle.velocity.y -= 3.2 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += delta * 5;
      particle.mesh.rotation.y += delta * 7;
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(particle.life / particle.maxLife, 0);

      if (particle.life <= 0) {
        this.boardGroup.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        material.dispose();
        this.particles.splice(index, 1);
      }
    }
  }

  private updateHud(): void {
    this.crystalCountElement.textContent = `${this.collectedCrystals} / ${this.level.crystals.length}`;
    this.moveCountElement.textContent = String(this.moves);
  }

  private setHint(message: string): void {
    this.hintElement.textContent = message;
    this.hintElement.classList.remove("hint--pulse");
    window.requestAnimationFrame(() => this.hintElement.classList.add("hint--pulse"));
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const portrait = height > width;
    this.camera.position.set(portrait ? 12.8 : 11, portrait ? 15.5 : 13, portrait ? 15.8 : 13);
    this.camera.lookAt(0, -0.3, 0);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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

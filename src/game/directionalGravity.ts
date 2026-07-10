import * as THREE from "three";
import type { Game } from "./Game";
import type { GridVector } from "./levels";

type MoveAction = "move-up" | "move-down" | "move-left" | "move-right";
type TiltAction = "tilt-up" | "tilt-down" | "tilt-left" | "tilt-right";

type RotationAnimationRuntime = {
  to: THREE.Quaternion;
};

type GameRuntime = {
  camera: THREE.PerspectiveCamera;
  stageRoot: THREE.Group;
  player: THREE.Group;
  gravity: GridVector;
  rotationAnimation: RotationAnimationRuntime | null;
  pendingScreenGravity?: GridVector | null;
};

type GamePrototypeRuntime = {
  tiltStage(this: Game, action: TiltAction): void;
  getLocalGravity(this: Game): GridVector;
  getScreenMovementDirection(this: Game, action: MoveAction): GridVector;
};

type GameConstructor = {
  prototype: Game;
};

type ScreenAxes = {
  right: THREE.Vector3;
  up: THREE.Vector3;
};

type SurfaceBasis = {
  right: GridVector;
  up: GridVector;
  score: number;
};

const PATCH_MARK = Symbol.for("gravity-grid.directional-controls.v5");

const CARDINAL_DIRECTIONS: readonly GridVector[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const vectorsEqual = (left: GridVector, right: GridVector): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z;

const dotGridVectors = (left: GridVector, right: GridVector): number =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const cloneGridVector = ({ x, y, z }: GridVector): GridVector => ({ x, y, z });

const negateGridVector = ({ x, y, z }: GridVector): GridVector => ({
  x: -x,
  y: -y,
  z: -z,
});

const toWorldDirection = (
  direction: GridVector,
  stageQuaternion: THREE.Quaternion,
): THREE.Vector3 =>
  new THREE.Vector3(direction.x, direction.y, direction.z)
    .applyQuaternion(stageQuaternion)
    .normalize();

const getScreenAxes = (camera: THREE.PerspectiveCamera): ScreenAxes => {
  camera.updateMatrixWorld();
  const cameraQuaternion = new THREE.Quaternion();
  camera.getWorldQuaternion(cameraQuaternion);

  return {
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize(),
  };
};

const getDesiredWorldDirection = (
  action: TiltAction,
  camera: THREE.PerspectiveCamera,
): THREE.Vector3 => {
  const screenAxes = getScreenAxes(camera);

  switch (action) {
    case "tilt-left":
      return screenAxes.right.negate();
    case "tilt-right":
      return screenAxes.right;
    case "tilt-up":
      return screenAxes.up;
    case "tilt-down":
      return screenAxes.up.negate();
  }
};

const findBestAlignedDirection = (
  candidates: readonly GridVector[],
  desiredWorldDirection: THREE.Vector3,
  stageQuaternion: THREE.Quaternion,
): GridVector | null => {
  let bestDirection: GridVector | null = null;
  let bestAlignment = Number.NEGATIVE_INFINITY;

  candidates.forEach((candidate) => {
    const alignment = toWorldDirection(candidate, stageQuaternion).dot(desiredWorldDirection);
    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      bestDirection = candidate;
    }
  });

  return bestDirection === null ? null : cloneGridVector(bestDirection);
};

const resolveScreenDirectionalGravity = (
  action: TiltAction,
  camera: THREE.PerspectiveCamera,
  targetStageQuaternion: THREE.Quaternion,
  currentGravity: GridVector,
): GridVector => {
  const candidates = CARDINAL_DIRECTIONS.filter(
    (candidate) => !vectorsEqual(candidate, currentGravity),
  );
  const resolved = findBestAlignedDirection(
    candidates,
    getDesiredWorldDirection(action, camera),
    targetStageQuaternion,
  );

  return resolved ?? negateGridVector(currentGravity);
};

const getTangentDirections = (gravity: GridVector): GridVector[] =>
  CARDINAL_DIRECTIONS.filter((candidate) => dotGridVectors(candidate, gravity) === 0).map(
    cloneGridVector,
  );

const scoreBasis = (
  tangentDirections: readonly GridVector[],
  projectDirection: (direction: GridVector) => THREE.Vector2,
): SurfaceBasis | null => {
  let bestBasis: SurfaceBasis | null = null;

  tangentDirections.forEach((rightDirection) => {
    tangentDirections.forEach((upDirection) => {
      if (dotGridVectors(rightDirection, upDirection) !== 0) {
        return;
      }

      const rightDelta = projectDirection(rightDirection);
      const upDelta = projectDirection(upDirection);
      const rightLength = rightDelta.length();
      const upLength = upDelta.length();
      if (rightLength < 0.00001 || upLength < 0.00001) {
        return;
      }

      const normalizedRight = rightDelta.clone().multiplyScalar(1 / rightLength);
      const normalizedUp = upDelta.clone().multiplyScalar(1 / upLength);
      const determinant =
        normalizedRight.x * normalizedUp.y - normalizedRight.y * normalizedUp.x;
      const crossAxisPenalty = Math.abs(normalizedRight.y) + Math.abs(normalizedUp.x);
      const visibility = Math.min(rightLength, upLength);
      const score =
        normalizedRight.x * 3.4 +
        normalizedUp.y * 3.4 +
        determinant * 1.2 -
        crossAxisPenalty * 0.7 +
        Math.min(visibility * 18, 1) * 0.35;

      if (bestBasis === null || score > bestBasis.score) {
        bestBasis = {
          right: cloneGridVector(rightDirection),
          up: cloneGridVector(upDirection),
          score,
        };
      }
    });
  });

  return bestBasis;
};

const projectWorldDirectionToScreen = (
  direction: GridVector,
  stageQuaternion: THREE.Quaternion,
  screenAxes: ScreenAxes,
): THREE.Vector2 => {
  const worldDirection = toWorldDirection(direction, stageQuaternion);
  return new THREE.Vector2(
    worldDirection.dot(screenAxes.right),
    worldDirection.dot(screenAxes.up),
  );
};

const chooseReadableTargetQuaternion = (
  targetStageQuaternion: THREE.Quaternion,
  gravity: GridVector,
  camera: THREE.PerspectiveCamera,
): THREE.Quaternion => {
  const tangentDirections = getTangentDirections(gravity);
  const screenAxes = getScreenAxes(camera);
  const gravityAxis = new THREE.Vector3(gravity.x, gravity.y, gravity.z).normalize();
  const quarterTurns = [0, 1, -1] as const;

  let bestQuaternion = targetStageQuaternion.clone();
  let bestScore = Number.NEGATIVE_INFINITY;

  quarterTurns.forEach((quarterTurn) => {
    const localRoll = new THREE.Quaternion().setFromAxisAngle(
      gravityAxis,
      quarterTurn * (Math.PI / 2),
    );
    const candidateQuaternion = targetStageQuaternion.clone().multiply(localRoll).normalize();
    const basis = scoreBasis(tangentDirections, (direction) =>
      projectWorldDirectionToScreen(direction, candidateQuaternion, screenAxes),
    );
    const rotationPenalty = Math.abs(quarterTurn) * 0.08;
    const score = (basis?.score ?? Number.NEGATIVE_INFINITY) - rotationPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestQuaternion = candidateQuaternion;
    }
  });

  return bestQuaternion;
};

const projectPlayerStepToScreen = (
  direction: GridVector,
  camera: THREE.PerspectiveCamera,
  stageQuaternion: THREE.Quaternion,
  player: THREE.Group,
): THREE.Vector2 => {
  camera.updateMatrixWorld();
  player.updateWorldMatrix(true, false);

  const originWorld = player.getWorldPosition(new THREE.Vector3());
  const targetWorld = originWorld
    .clone()
    .add(toWorldDirection(direction, stageQuaternion));
  const originScreen = originWorld.clone().project(camera);
  const targetScreen = targetWorld.project(camera);

  return new THREE.Vector2(
    targetScreen.x - originScreen.x,
    targetScreen.y - originScreen.y,
  );
};

const resolveSurfaceMovementDirection = (
  action: MoveAction,
  runtime: GameRuntime,
): GridVector => {
  const tangentDirections = getTangentDirections(runtime.gravity);
  const projectedBasis = scoreBasis(tangentDirections, (direction) =>
    projectPlayerStepToScreen(
      direction,
      runtime.camera,
      runtime.stageRoot.quaternion,
      runtime.player,
    ),
  );

  const fallbackScreenAxes = getScreenAxes(runtime.camera);
  const fallbackRight = findBestAlignedDirection(
    tangentDirections,
    fallbackScreenAxes.right,
    runtime.stageRoot.quaternion,
  );
  const fallbackVerticalCandidates = tangentDirections.filter(
    (candidate) =>
      fallbackRight === null || dotGridVectors(candidate, fallbackRight) === 0,
  );
  const fallbackUp = findBestAlignedDirection(
    fallbackVerticalCandidates,
    fallbackScreenAxes.up,
    runtime.stageRoot.quaternion,
  );

  const rightDirection = projectedBasis?.right ?? fallbackRight ?? tangentDirections[0] ?? {
    x: 1,
    y: 0,
    z: 0,
  };
  const upDirection =
    projectedBasis?.up ??
    fallbackUp ??
    tangentDirections.find((candidate) => dotGridVectors(candidate, rightDirection) === 0) ??
    rightDirection;

  switch (action) {
    case "move-right":
      return cloneGridVector(rightDirection);
    case "move-left":
      return negateGridVector(rightDirection);
    case "move-up":
      return cloneGridVector(upDirection);
    case "move-down":
      return negateGridVector(upDirection);
  }
};

/**
 * Keeps SHIFT arrows visually truthful and rebuilds a readable two-axis MOVE
 * basis for every floor, wall, and ceiling. The target chamber orientation is
 * allowed one local quarter-roll around the new gravity axis so that one grid
 * axis reads horizontally and the other reads vertically on the actual screen.
 */
export const installDirectionalGravity = (GameClass: GameConstructor): void => {
  const prototype = GameClass.prototype as unknown as GamePrototypeRuntime;
  const patchState = prototype as unknown as Record<PropertyKey, unknown>;
  if (patchState[PATCH_MARK] === true) {
    return;
  }
  patchState[PATCH_MARK] = true;

  const originalTiltStage = prototype.tiltStage;
  const originalGetLocalGravity = prototype.getLocalGravity;

  prototype.tiltStage = function directionalTilt(action: TiltAction): void {
    originalTiltStage.call(this, action);

    const runtime = this as unknown as GameRuntime;
    const rotationAnimation = runtime.rotationAnimation;
    if (rotationAnimation === null) {
      return;
    }
    const targetStageQuaternion = rotationAnimation.to;

    const nextGravity = resolveScreenDirectionalGravity(
      action,
      runtime.camera,
      targetStageQuaternion,
      runtime.gravity,
    );
    runtime.pendingScreenGravity = nextGravity;
    rotationAnimation.to = chooseReadableTargetQuaternion(
      targetStageQuaternion,
      nextGravity,
      runtime.camera,
    );
  };

  prototype.getLocalGravity = function getDirectionalLocalGravity(): GridVector {
    const runtime = this as unknown as GameRuntime;
    const pendingGravity = runtime.pendingScreenGravity;

    if (pendingGravity !== undefined && pendingGravity !== null) {
      runtime.pendingScreenGravity = null;
      return cloneGridVector(pendingGravity);
    }

    return originalGetLocalGravity.call(this);
  };

  prototype.getScreenMovementDirection = function surfaceRelativeMovement(
    action: MoveAction,
  ): GridVector {
    return resolveSurfaceMovementDirection(action, this as unknown as GameRuntime);
  };
};

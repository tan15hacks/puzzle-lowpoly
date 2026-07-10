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

const patchedClasses = new WeakSet<object>();

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

/**
 * Builds two independent movement axes on the surface the robot is currently
 * standing on. Horizontal input follows the camera's screen-right vector,
 * while vertical input uses the remaining tangent axis that best follows
 * screen-up. Keeping those axes independent prevents wall movement from
 * collapsing into left/right-only controls.
 */
const resolveSurfaceMovementDirection = (
  action: MoveAction,
  camera: THREE.PerspectiveCamera,
  stageQuaternion: THREE.Quaternion,
  gravity: GridVector,
): GridVector => {
  const tangentDirections = CARDINAL_DIRECTIONS.filter(
    (candidate) => dotGridVectors(candidate, gravity) === 0,
  );
  const screenAxes = getScreenAxes(camera);

  const screenRightDirection = findBestAlignedDirection(
    tangentDirections,
    screenAxes.right,
    stageQuaternion,
  );

  if (screenRightDirection === null) {
    return { x: 1, y: 0, z: 0 };
  }

  const verticalCandidates = tangentDirections.filter(
    (candidate) => dotGridVectors(candidate, screenRightDirection) === 0,
  );
  const screenUpDirection = findBestAlignedDirection(
    verticalCandidates,
    screenAxes.up,
    stageQuaternion,
  );

  const resolvedUp = screenUpDirection ?? verticalCandidates[0] ?? screenRightDirection;

  switch (action) {
    case "move-right":
      return cloneGridVector(screenRightDirection);
    case "move-left":
      return negateGridVector(screenRightDirection);
    case "move-up":
      return cloneGridVector(resolvedUp);
    case "move-down":
      return negateGridVector(resolvedUp);
  }
};

/**
 * Keeps each SHIFT arrow visually truthful and keeps MOVE controls usable on
 * every chamber face. Gravity follows the pressed screen direction, and the
 * movement pad is rebuilt from the two axes tangent to the current surface.
 */
export const installDirectionalGravity = (GameClass: GameConstructor): void => {
  if (patchedClasses.has(GameClass)) {
    return;
  }
  patchedClasses.add(GameClass);

  const prototype = GameClass.prototype as unknown as GamePrototypeRuntime;
  const originalTiltStage = prototype.tiltStage;
  const originalGetLocalGravity = prototype.getLocalGravity;

  prototype.tiltStage = function directionalTilt(action: TiltAction): void {
    originalTiltStage.call(this, action);

    const runtime = this as unknown as GameRuntime;
    const targetStageQuaternion = runtime.rotationAnimation?.to;
    if (targetStageQuaternion === undefined) {
      return;
    }

    runtime.pendingScreenGravity = resolveScreenDirectionalGravity(
      action,
      runtime.camera,
      targetStageQuaternion,
      runtime.gravity,
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
    const runtime = this as unknown as GameRuntime;
    return resolveSurfaceMovementDirection(
      action,
      runtime.camera,
      runtime.stageRoot.quaternion,
      runtime.gravity,
    );
  };
};

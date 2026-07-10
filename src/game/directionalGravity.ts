import * as THREE from "three";
import type { Game } from "./Game";
import type { GridVector } from "./levels";

type TiltAction = "tilt-up" | "tilt-down" | "tilt-left" | "tilt-right";

type RotationAnimationRuntime = {
  to: THREE.Quaternion;
};

type GameRuntime = {
  camera: THREE.PerspectiveCamera;
  gravity: GridVector;
  rotationAnimation: RotationAnimationRuntime | null;
  pendingScreenGravity?: GridVector | null;
};

type GamePrototypeRuntime = {
  tiltStage(this: Game, action: TiltAction): void;
  getLocalGravity(this: Game): GridVector;
};

type GameConstructor = {
  prototype: Game;
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

const cloneGridVector = ({ x, y, z }: GridVector): GridVector => ({ x, y, z });

const getDesiredWorldDirection = (
  action: TiltAction,
  camera: THREE.PerspectiveCamera,
): THREE.Vector3 => {
  const cameraQuaternion = new THREE.Quaternion();
  camera.getWorldQuaternion(cameraQuaternion);

  const screenRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(cameraQuaternion)
    .normalize();
  const screenUp = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(cameraQuaternion)
    .normalize();

  switch (action) {
    case "tilt-left":
      return screenRight.negate();
    case "tilt-right":
      return screenRight;
    case "tilt-up":
      return screenUp;
    case "tilt-down":
      return screenUp.negate();
  }
};

const resolveScreenDirectionalGravity = (
  action: TiltAction,
  camera: THREE.PerspectiveCamera,
  targetStageQuaternion: THREE.Quaternion,
  currentGravity: GridVector,
): GridVector => {
  const desiredWorldDirection = getDesiredWorldDirection(action, camera);
  let bestDirection: GridVector | null = null;
  let bestAlignment = Number.NEGATIVE_INFINITY;

  CARDINAL_DIRECTIONS.forEach((candidate) => {
    if (vectorsEqual(candidate, currentGravity)) {
      return;
    }

    const candidateWorldDirection = new THREE.Vector3(
      candidate.x,
      candidate.y,
      candidate.z,
    )
      .applyQuaternion(targetStageQuaternion)
      .normalize();
    const alignment = candidateWorldDirection.dot(desiredWorldDirection);

    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      bestDirection = candidate;
    }
  });

  return cloneGridVector(
    bestDirection ?? {
      x: -currentGravity.x,
      y: -currentGravity.y,
      z: -currentGravity.z,
    },
  );
};

/**
 * Keeps each SHIFT arrow visually truthful: after the chamber turns, gravity
 * snaps to the chamber axis that projects closest to the pressed screen
 * direction. A left shift therefore makes the robot travel left on screen
 * instead of always dropping vertically in world space.
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
};

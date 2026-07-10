import "./style.css";
import { Game } from "./game/Game";
import { installDirectionalGravity } from "./game/directionalGravity";

installDirectionalGravity(Game);

const canvas = document.getElementById("game-canvas");

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("The Gravity Grid canvas could not be initialized.");
}

new Game(canvas);

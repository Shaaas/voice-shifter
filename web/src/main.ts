import { AudioEngine } from "./audio";
import { UI } from "./ui";

const engine = new AudioEngine();
const ui = new UI(engine);

ui.render();
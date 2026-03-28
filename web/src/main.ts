import { AudioEngine } from "./audio";
import { UI } from "./ui";

const engine = new AudioEngine();
const ui = new UI(engine);

ui.render();

// Initialize WASM in background
engine.initWasm().then(() => {
  console.log("WASM voice engine ready");
}).catch((e) => {
  console.warn("WASM init failed, falling back to JS engine", e);
});
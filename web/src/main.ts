import { AudioEngine } from "./audio";
import { UI } from "./ui";

const engine = new AudioEngine();
const ui = new UI(engine);

ui.render();

engine.initWasm().then(() => {
  console.log("[Polyphon] WASM phase vocoder ready");
}).catch((e) => {
  console.warn("[Polyphon] WASM unavailable, using JS engine", e);
});

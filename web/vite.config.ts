import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["./src/wasm/voice_core.js"]
  },
  assetsInclude: ["**/*.wasm"],
});
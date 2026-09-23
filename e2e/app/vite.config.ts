import { defineConfig } from "vite";

export default defineConfig({
  // Tests drive the page through `window.e2e`; a reload in the middle of a test would lose its state.
  server: { hmr: false },
});

import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works under https://addstack.github.io/managed-modals/.
  base: "./",
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // The library's "use client" directives mean nothing in a single-page app.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});

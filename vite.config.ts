import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    strictPort: true,
  },
  build: {
    target: "chrome132",
    minify: "esbuild",
    sourcemap: false,
  },
});

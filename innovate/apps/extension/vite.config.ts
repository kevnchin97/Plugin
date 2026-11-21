import { resolve } from "node:path";
import { defineConfig } from "vite";

/** MV3 build: a module service worker plus two pages. Static files (manifest, icons) come from public/. */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background.ts"),
        popup: resolve(import.meta.dirname, "popup.html"),
        options: resolve(import.meta.dirname, "options.html"),
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
});

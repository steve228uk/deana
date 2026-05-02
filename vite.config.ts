import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { fileURLToPath } from "url";
import path from "path";

const autoDefinitionsStub = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "src/lib/autoDefinitions.stub.ts",
);

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === "build" ? [visualizer({ filename: "stats.html", gzipSize: true, brotliSize: true })] : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-ai": ["ai", "@ai-sdk/react", "@ai-sdk/gateway"],
          "vendor-markdown": ["react-markdown", "rehype-sanitize", "remark-gfm"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // Belt-and-suspenders: also alias the import so Vite's transform stage
    // never tries to read the potentially huge generated file.
    // The regex anchors on ^ and $ so String.replace swaps the entire specifier.
    alias: [{ find: /^.*\/autoDefinitions(\.ts)?$/, replacement: autoDefinitionsStub }],
  },
}));

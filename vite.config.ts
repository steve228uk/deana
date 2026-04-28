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
    // Stub out the auto-generated definitions file — it can be very large
    // after the evidence pack build and would cause V8 to OOM while parsing it.
    // Tests only exercise the 12 hand-crafted definitions, not auto-generated ones.
    alias: [{ find: /\/autoDefinitions$/, replacement: autoDefinitionsStub }],
  },
}));

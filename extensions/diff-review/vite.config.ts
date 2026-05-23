import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    include: ["src/**/*.test.ts", "session.test.ts"],
    environment: "happy-dom",
    setupFiles: ["src/test/setup.ts"],
  },
});

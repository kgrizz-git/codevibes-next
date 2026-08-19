import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // The backend is a separate package with its own vitest config; never
    // let the frontend runner recurse into it (or its build output).
    exclude: ["**/node_modules/**", "**/.git/**", "codevibes-backend/**", "dist/**", "tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// NOTE: kept as a static config object (not a ({ mode }) => … callback) because
// vitest's mergeConfig cannot merge callback configs. componentTagger is a
// Lovable dev-only affordance, so it is gated on NODE_ENV === "development"
// (vite dev sets this; `vitest run` sets "test", `vite build` sets "production").
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), process.env.NODE_ENV === "development" && componentTagger()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser bundle. Only VITE_* variables reach it, and the only one this app reads is the
// Clerk PUBLISHABLE key (public by design). Every secret stays on the server (server/config.ts);
// scripts/check-bundle.mjs fails the build if one ever appears in dist/.
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_"],
  server: { allowedHosts: true },
  build: { outDir: "dist", sourcemap: false },
});

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, liveSource } from "./app.js";
import { loadConfig } from "./config.js";
import { createMockSource } from "./mockSource.js";

// One process, one HTTP listener on the platform's PORT/HOST. In development Vite is mounted as
// middleware on the same listener; in production the built UI is served from dist/.

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), process.env["NODE_ENV"] === "production" ? "../.." : "..");
const cfg = loadConfig();
const source = cfg.sourceMode === "mock" ? createMockSource() : liveSource(cfg);

if (cfg.problems.length > 0) {
  // Names only. The app still starts so /health answers and the UI can show what is missing.
  console.warn(`[internal-sourcing-app] setup incomplete — every API call answers 503 until fixed:\n  - ${cfg.problems.join("\n  - ")}`);
}
if (cfg.sourceMode === "mock") console.warn("[internal-sourcing-app] SOURCE_MODE=mock: in-memory SAMPLE data, not the sourcing backend.");
if (cfg.authMode === "dev") console.warn("[internal-sourcing-app] AUTH_MODE=dev: local development sign-in, no Clerk.");

const app = createApp(cfg, { source, staticDir: cfg.production ? resolve(root, "dist") : null });

if (!cfg.production) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(cfg.port, cfg.host, () => {
  console.log(`[internal-sourcing-app] listening on http://${cfg.host}:${cfg.port} (source: ${cfg.sourceMode}, sign-in: ${cfg.authMode})`);
});

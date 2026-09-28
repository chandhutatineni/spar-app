// Private dev server for the insights feature's own browser tests: same app, no HMR (so other
// features' edits don't reload the page mid-test). `npx vite --config src/features/insights/dev/vite.config.mjs`
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ root: new URL("../../../../", import.meta.url).pathname, plugins: [react()], server: { port: 1439, strictPort: true, hmr: false, watch: null } });

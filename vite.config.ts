import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    // Icons: every "lucide-react" import goes through src/ui/icons.tsx (SF Symbols on macOS).
    alias: [
      { find: /^lucide-react$/, replacement: fileURLToPath(new URL("./src/ui/icons.tsx", import.meta.url)) },
      { find: /^lucide-real$/, replacement: fileURLToPath(new URL("./node_modules/lucide-react/dist/esm/lucide-react.mjs", import.meta.url)) },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

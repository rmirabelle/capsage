import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;
const DEV_PORT = 14310;
const HMR_PORT = 14311;
const PREVIEW_PORT = 14312;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: HMR_PORT } : undefined,
    watch: { ignored: ["**/src-tauri/**"] }
  },
  preview: {
    port: PREVIEW_PORT,
    strictPort: true
  }
});

import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(here, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  build: {
    outDir: path.resolve(here, "../server/internal/web/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
})

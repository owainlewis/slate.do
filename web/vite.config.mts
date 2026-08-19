import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))
const apiTarget = process.env.SLATE_API_URL || "http://127.0.0.1:8080"
const apiOrigin = new URL(apiTarget).origin
const webPort = Number(process.env.SLATE_WEB_PORT || "8081")

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(here, "src") } },
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", request => request.setHeader("Origin", apiOrigin))
        },
      },
    },
  },
  build: {
    outDir: path.resolve(here, "../server/internal/web/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
})

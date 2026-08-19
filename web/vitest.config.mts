import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(here, "src") } },
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
})

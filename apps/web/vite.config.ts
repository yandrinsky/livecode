import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        "react-preview": resolve(__dirname, "react-preview.html"),
      },
    },
  },
  server: {
    port: 5173,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
});

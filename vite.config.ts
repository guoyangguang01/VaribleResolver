import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/@codemirror") ||
            id.includes("node_modules/@lezer")
          ) {
            return "codemirror";
          }
          if (id.includes("node_modules/react")) {
            return "react";
          }
        },
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://red-alert-wso0.onrender.com",
        changeOrigin: true,
      },
      "/health": {
        target: "https://red-alert-wso0.onrender.com",
        changeOrigin: true,
      },
    },
  },
});
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs separately (pnpm --filter @camporee-conductor/composer-api start, :3010);
// in production it serves the built app itself (ADR-0008, issue #4 D5).
const api = "http://localhost:3010";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": api, "/auth-config": api, "/health": api },
  },
});

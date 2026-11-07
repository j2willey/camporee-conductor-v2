import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the Collator runs separately (pnpm --filter @camporee-conductor/collator start, :3030);
// on the box it serves the built app itself (WEB_ROOT).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:3030" },
  },
});

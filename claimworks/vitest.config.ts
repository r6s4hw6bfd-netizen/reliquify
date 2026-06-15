import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the tsconfig "@/*" -> "./src/*" alias so tests can import the API route handlers
// (which use "@/lib/...") the same way the Next build resolves them.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "activity",
    root: import.meta.dirname,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});

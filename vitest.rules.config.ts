import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/firestore.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});

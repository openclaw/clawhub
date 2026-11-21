import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/dependency-account-compat.proof.ts"],
    testTimeout: 15_000,
    maxWorkers: 1,
  },
});

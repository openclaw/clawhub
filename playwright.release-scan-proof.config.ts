import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Operator-only proof: requires a fresh disposable local Convex catalog.
// Its .proof.ts suffix keeps it outside ordinary public-preview discovery.
export default defineConfig({
  ...base,
  testMatch: "release-scan-backfill.proof.ts",
  projects: base.projects?.filter((project) => project.name === "chromium"),
  fullyParallel: false,
  workers: 1,
  webServer: undefined,
});

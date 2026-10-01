/* @vitest-environment node */
import { describe, expect, it } from "vitest";

const { checkDependencyRegistriesHandler } = await import("./depRegistryScan");

describe("dependency registry scan drain", () => {
  it("keeps legacy scheduled jobs harmless after the scanner is retired", async () => {
    await expect(checkDependencyRegistriesHandler()).resolves.toBeNull();
  });
});

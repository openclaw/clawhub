import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel preview configuration", () => {
  it("uses the environment-aware build entrypoint without production-pinned rewrites", async () => {
    const configText = await readFile("vercel.json", "utf8");
    const config = JSON.parse(configText) as {
      buildCommand?: string;
      rewrites?: unknown[];
    };
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(config.buildCommand).toBe("bun run build:vercel");
    expect(config.rewrites).toBeUndefined();
    expect(configText).not.toContain("wry-manatee-359");
    expect(packageJson.scripts?.["build:vercel"]).toBe("bun scripts/vercel-build.ts");
  });
});

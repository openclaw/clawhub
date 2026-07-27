/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const digest = `sha256:${"a".repeat(64)}`;

describe("experimental Claw feed runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores and serves the exact publication only while the gate is enabled", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const stored = await t.mutation(internal.catalogFeed.storeClawPublication, {
      generatedAt: "2026-07-24T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
      entries: [
        {
          type: "claw",
          id: "@openclaw/runtime-proof",
          title: "Runtime proof",
          version: "1.0.0",
          state: "available",
          publisher: { id: "openclaw", trust: "official" },
          clawManifestSummary: {
            schemaVersion: 1,
            agent: { id: "runtime-proof", name: "Runtime proof" },
            workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
            packages: { skillCount: 0, pluginCount: 0 },
            mcpServerCount: 0,
            cronJobCount: 0,
          },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/runtime-proof",
                version: "1.0.0",
                integrity: digest,
              },
            ],
          },
        },
      ],
    });
    expect(stored).toMatchObject({
      feedId: "clawhub-official-claws",
      sequence: 1,
      entryCount: 1,
    });

    const publication = await t.query(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official-claws",
    });
    expect(publication?.payload).toContain('"id":"@openclaw/runtime-proof"');

    const enabled = await t.fetch("/api/v1/feeds/claws");
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("cache-control")).toBe("no-store");
    expect(enabled.headers.get("surrogate-control")).toBeNull();
    expect(await enabled.text()).toBe(publication?.payload);

    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "0");
    const disabled = await t.fetch("/api/v1/feeds/claws");
    expect(disabled.status).toBe(404);
    expect(disabled.headers.get("cache-control")).toBe("no-store");
  });
});

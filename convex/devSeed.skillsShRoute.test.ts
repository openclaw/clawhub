/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "local");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});

afterEach(() => vi.unstubAllEnvs());

it("serves the seeded skills.sh detail through the public local route", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.devSeed.seedCanonicalSearchFixture, {});

  await expect(
    t.query(api.skillsShMirrorPublic.getByRoute, {
      owner: "doany-skills",
      repo: "skills",
      slug: "reddit-automation",
    }),
  ).resolves.toMatchObject({
    kind: "external",
    entry: {
      externalId: "doany-skills/skills/reddit-automation",
      displayName: "Reddit Automation",
      upstreamInstalls: 202_996,
      githubPath: "reddit-automation",
      githubCommit: "6875ced8582825395c976099fcc6a00734bb09b1",
      content: {
        kind: "skill-md",
        path: "SKILL.md",
        truncated: false,
      },
    },
  });
});

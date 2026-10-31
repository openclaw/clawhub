/// <reference types="vite/client" />
/* @vitest-environment node */

import { createServer } from "node:http";
import { convexTest } from "convex-test";
import { createApp, toNodeListener } from "h3";
import { it, expect, vi, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
const modules = import.meta.glob("../convex/**/*.ts");
vi.mock("@vercel/oidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/oidc")>()),
  getVercelOidcToken: async () => "fixture-oidc",
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
import {
  fetchSkillsShMirrorBatch,
  measureSkillsShMirrorProofSource,
  measureSkillsShTrendingSource,
} from "./skillsShCatalogSource";
const valid = {
  id: "owner/repo/skill",
  installUrl: "https://github.com/owner/repo",
  installs: 1,
  name: "Skill",
  slug: "skill",
  source: "owner/repo",
  sourceType: "github",
  url: "https://www.skills.sh/owner/repo/skill",
};
function fixture(rows: unknown[]) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/skills?"))
      return Response.json({
        data: url.includes("page=0") ? rows : [],
        pagination: {
          page: url.includes("page=0") ? 0 : 1,
          perPage: 500,
          total: rows.length,
          hasMore: false,
        },
      });
    if (url.includes("/search?")) return Response.json({ data: [valid] });
    if (url.includes("/audit")) return Response.json({});
    if (url.includes("/api/v1/skills/owner/repo/skill"))
      return Response.json({
        id: valid.id,
        slug: valid.slug,
        source: valid.source,
        installs: 1,
        files: [],
      });
    if (url.startsWith(valid.url)) return new Response("<html></html>");
    throw new Error(`Unexpected fixture request: ${url}`);
  };
}
it("batch preserves valid row while quarantining numeric id and object source", async () => {
  const rows = [{ ...valid, id: 12, source: { repo: "owner/repo" } }, valid];
  const result = await fetchSkillsShMirrorBatch(
    { page: 0, offset: 0, limit: 2, maxDetailBytes: 64 },
    { oidcToken: "fixture", fetchImpl: fixture(rows) as typeof fetch, githubLocatorResolver: null },
  );
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ quarantined: true, externalId: "missing" });
  expect(result.rows[1]).toMatchObject({ externalId: valid.id, sourceType: "github" });
});
it("proof measurement should retain mixed numeric-id page for quarantine", async () => {
  const rows = [{ ...valid, id: 12 }, valid];
  await expect(
    measureSkillsShMirrorProofSource({
      oidcToken: "fixture",
      fetchImpl: fixture(rows) as typeof fetch,
    }),
  ).resolves.toMatchObject({ catalogTotal: 2 });
});
it("proof measurement should skip object-source row when selecting metadata sample", async () => {
  const rows = [{ ...valid, id: "bad/repo/skill", source: {} }, valid];
  await expect(
    measureSkillsShMirrorProofSource({
      oidcToken: "fixture",
      fetchImpl: fixture(rows) as typeof fetch,
    }),
  ).resolves.toMatchObject({ catalogTotal: 2 });
});
it("trending measurement should retain mixed numeric-id page for quarantine", async () => {
  const rows = [{ ...valid, id: 12 }, valid];
  await expect(
    measureSkillsShTrendingSource({
      oidcToken: "fixture",
      fetchImpl: fixture(rows) as typeof fetch,
    }),
  ).resolves.toMatchObject({ catalogTotal: 2 });
});

it.each(["start", "start-trending"] as const)(
  "HTTP %s captures mixed rows without moving their positions",
  async (operation) => {
    for (const [key, value] of Object.entries({
      CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      CLAWHUB_DISABLE_CRONS: "1",
      CLAWHUB_ENV: "test",
      CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
      VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
      VITE_CLAWHUB_DEPLOY_ENV: "test",
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "test",
      CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
    }))
      vi.stubEnv(key, value);
    const t = convexTest(schema, modules);
    await t.mutation(internal.skillsShMirror.configureInternal, {
      actor: "local-fixture",
      reason: "malformed rows regression",
      confirm: "enable-skills-sh-mirror-test",
      enabled: true,
      maxRowsPerRun: 10000,
      maxRowsPerBatch: 50,
      maxDetailBytes: 65536,
    });
    const rows = [
      { ...valid, id: 12 },
      { ...valid, id: 13 },
      { ...valid, id: "bad/repo/skill", source: {} },
      valid,
    ];
    const sourceFetch = fixture(rows);
    const operatorCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://academic-chihuahua-392.convex.site/")) return sourceFetch(input);
      const { operation: op, ...args } = JSON.parse(String(init?.body));
      operatorCalls.push(op);
      if (op === "mirror-status") return Response.json({ runs: [] });
      if (op === "mirror-source-page-store")
        return Response.json(
          await t.mutation(internal.skillsShMirror.storeSourcePageInternal, args),
        );
      if (op === "mirror-source-summary")
        return Response.json(
          await t.query(internal.skillsShMirror.getSourceCaptureSummaryInternal, args),
        );
      if (op === "mirror-start")
        return Response.json(
          await t.mutation(internal.skillsShMirror.startRunInternal, {
            ...args,
            actor: "local-fixture",
          }),
        );
      if (op === "mirror-batch-claim")
        return Response.json(
          await t.mutation(internal.skillsShMirror.claimBatchLeaseInternal, args),
        );
      if (op === "mirror-batch-release")
        return Response.json(
          await t.mutation(internal.skillsShMirror.releaseBatchLeaseInternal, args),
        );
      if (op === "mirror-classification-states") return Response.json({ states: [] });
      if (op === "mirror-trending-join-state")
        return Response.json(
          await t.query(internal.skillsShMirror.getTrendingJoinStateInternal, args),
        );
      if (op === "mirror-trending-hydrate")
        return Response.json(
          await t.mutation(internal.skillsShMirror.hydrateTrendingBatchInternal, args),
        );
      if (op === "mirror-trending-batch")
        return Response.json(
          await t.mutation(internal.skillsShMirror.processTrendingBatchInternal, args),
        );
      if (op === "mirror-batch") {
        const { sourcePageIdentityHash: _hash, ...batchArgs } = args;
        return Response.json(
          await t.mutation(internal.skillsShMirror.processBatchInternal, batchArgs),
        );
      }
      throw new Error(`unexpected operator ${op}`);
    });
    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const app = createApp();
    app.use("/ops/skills-sh/mirror-test", handler);
    const server = createServer(toNodeListener(app));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing address");
      // Use the original fetch for the loopback HTTP entrypoint; outbound calls remain fixtures.
      const response = await nativeFetch(
        `http://127.0.0.1:${address.port}/ops/skills-sh/mirror-test`,
        {
          method: "POST",
          headers: { Authorization: "Bearer fixture-operator", "Content-Type": "application/json" },
          body: JSON.stringify({ operation, reason: "local regression proof" }),
        },
      );
      const body = await response.json();
      console.log(
        JSON.stringify({
          operation,
          url: `http://127.0.0.1:${address.port}/ops/skills-sh/mirror-test`,
          status: response.status,
          message: body.message,
          sourceTotal: body.sourceTotal,
          sourceCapture: body.sourceCapture,
          operatorCalls,
        }),
      );
      expect(response.status).toBe(200);
      const pages = await t.run((ctx) => ctx.db.query("skillsShMirrorSourcePages").collect());
      expect(pages).toHaveLength(1);
      expect(pages[0]?.pageLength).toBe(4);
      expect(pages[0]?.rows.map((row) => row.id)).toEqual([
        "missing:0:0",
        "missing:0:1",
        "bad/repo/skill",
        valid.id,
      ]);
      expect(pages[0]?.rows[2]?.source).toBe("");
      const captured = pages[0]!;
      const batch = await fetchSkillsShMirrorBatch(
        { page: 0, offset: 0, limit: 4, maxDetailBytes: 64 },
        {
          oidcToken: "fixture",
          fetchImpl: sourceFetch as typeof fetch,
          githubLocatorResolver: null,
          sourcePage: {
            data: captured.rows,
            pagination: { page: 0, perPage: 500, total: 4, hasMore: false },
          },
        },
      );
      expect(batch.rows.slice(0, 3).every((row) => "quarantined" in row)).toBe(true);
      expect(batch.rows[3]).toMatchObject({ externalId: valid.id });
      expect(batch.sourcePageIdentityHash).toBe(captured.identityHash);
      const stepResponse = await nativeFetch(
        `http://127.0.0.1:${address.port}/ops/skills-sh/mirror-test`,
        {
          method: "POST",
          headers: { Authorization: "Bearer fixture-operator", "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: operation === "start" ? "step" : "step-trending",
            runId: body.runId,
            page: 0,
            offset: 0,
          }),
        },
      );
      const stepBody = await stepResponse.json();
      console.log(
        JSON.stringify({
          operation,
          capturedIds: captured.rows.map((row) => row.id),
          stepStatus: stepResponse.status,
          stepBody,
          operatorCalls,
        }),
      );
      expect(stepResponse.status).toBe(200);
      expect(stepBody.counts.observed).toBe(4);
      if (operation === "start") {
        expect(stepBody.counts.quarantined).toBe(3);
        expect(stepBody.counts.inserted).toBe(1);
        const conflicts = await t.run((ctx) => ctx.db.query("skillsShMirrorConflicts").collect());
        expect(conflicts.map((row) => row.offset)).toEqual([0, 1, 2]);
      } else {
        expect(stepBody.counts.trendingJoined).toBe(1);
        expect(stepBody.counts.trendingMissing).toBe(3);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
const nativeFetch = globalThis.fetch;

it.each([measureSkillsShMirrorProofSource, measureSkillsShTrendingSource])(
  "still rejects repeated real IDs",
  async (measure) => {
    await expect(
      measure({ oidcToken: "fixture", fetchImpl: fixture([valid, valid]) as typeof fetch }),
    ).rejects.toThrow(/duplicate identities/);
  },
);

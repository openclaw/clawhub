/* @vitest-environment node */
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const fixture = {
  artifactKind: "skill",
  scope: "catalog",
  window: {
    endDay: 1788825600000,
    start7d: 1788220800000,
    startPrevious7d: 1787616000000,
    start30d: 1786233600000,
    days: 7,
  },
  source: "clawhub-web",
  generatedAt: 1788825600000,
  totalQueries: 1,
  totalSearches7d: 5,
  sources7d: { "clawhub-web": 5, "openclaw-control-ui": 0 },
  truncated: false,
  classificationStatus: "partial",
  classificationRun: {
    weekStart: 1788220800000,
    weekEnd: 1788825600000,
    processedAt: 1788825600000,
    expectedQualified: 1,
    classifiedCount: 1,
    truncated: true,
    model: "fixture-model",
    modelVersion: "v1",
  },
  metadataCheckedAt: 1788825600000,
  currentMetadataStatus: "available",
  coverage: {
    dataThrough: 1788825600000,
    collectionStartedAt: 1788220800000,
    gapStart: null,
    gapEnd: null,
  },
  rows: [
    {
      query: "notion",
      artifactKind: "skill",
      scope: "catalog",
      searches7d: 5,
      searchesPrevious7d: 2,
      searches30d: 11,
      officialGaps7d: 5,
      officialGaps30d: 9,
      zeroResults7d: 0,
      change7d: 3,
      changePercent: 150,
      sources7d: { "clawhub-web": 5, "openclaw-control-ui": 0 },
      classification: null,
      companyOpportunity: false,
      searchUrl: "/plugins?q=notion",
      currentResults: [],
      featuredCandidate: null,
    },
  ],
};
const intelligence = {
  searchReport: fixture,
  metadataCheckedAt: fixture.generatedAt,
  adoption: {
    status: "available",
    generatedAt: fixture.generatedAt,
    periodStart: fixture.window.start7d,
    periodEnd: fixture.window.endDay,
    snapshotId: "observed",
    rankingVersion: "skills-trending-v4",
    totalItems: 1,
    inspectedItems: 1,
    truncated: false,
  },
  recommendations: {
    lineup: {
      targetSize: 8,
      baseline: [],
      removals: [],
      shortfall: 7,
      proposed: [] as unknown[],
    },
    totalCandidates: 1,
    omittedCandidates: 0,
    excluded: [],
    candidates: [
      {
        id: "clawhub:calendar",
        artifactKind: "skill",
        name: "calendar",
        displayName: "Calendar",
        summary: "Keep events synchronized",
        url: "/author/skills/calendar",
        category: "productivity",
        version: "1.0.0",
        eligibleForFeatured: true,
        eligibilityReasons: [],
        support: "adoption-only",
        search: null,
        adoption: {
          source: "clawhub-trending",
          rank: 1,
          snapshotId: "observed",
          rankingVersion: "skills-trending-v4",
          periodStart: fixture.window.start7d,
          periodEnd: fixture.window.endDay,
          generatedAt: fixture.generatedAt,
          sourceObservedAt: null,
          downloads: 40,
          installs: 3,
          bookmarks: 2,
          lifetimeInstalls: null,
        },
      },
    ],
  },
};
intelligence.recommendations.lineup.proposed = intelligence.recommendations.candidates.map(
  (candidate) => ({ ...candidate, change: "add", emerging: false }),
);

type Request = { method: string; path: string; body: unknown; authorization: string | undefined };
function envelope(status: string, view = "demand", extra: Record<string, unknown> = {}) {
  return {
    reportId: "report-fixture",
    view,
    status,
    requestedAt: Date.now(),
    completedAt: status === "ready" ? Date.now() : null,
    expirationTime: Date.now() + 86_400_000,
    previousAttempts: 0,
    failureCode: null,
    reportVersion: "search-report-v1",
    ...(status === "ready" ? { report: view === "recommendations" ? intelligence : fixture } : {}),
    ...extra,
  };
}
async function withServer(
  handler: (request: Request, index: number) => { body: unknown; status?: number },
  run: (client: {
    args: string[];
    env: NodeJS.ProcessEnv;
    requests: Request[];
    cli: (args?: string[]) => Promise<{ stdout: string; stderr: string }>;
  }) => Promise<void>,
  registrySuffix = "",
) {
  const requests: Request[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const recorded = {
      method: request.method ?? "",
      path: request.url ?? "",
      body: text ? JSON.parse(text) : null,
      authorization: request.headers.authorization,
    };
    requests.push(recorded);
    const result = handler(recorded, requests.length - 1);
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    // The admission endpoint returns status only, including a reused ready generation.
    const body =
      recorded.method === "POST" && result.body && typeof result.body === "object"
        ? Object.fromEntries(Object.entries(result.body).filter(([key]) => key !== "report"))
        : result.body;
    response.end(JSON.stringify(body));
  });
  const dir = await mkdtemp(join(tmpdir(), "search-insights-cli-"));
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const registry = `http://127.0.0.1:${address.port}${registrySuffix}`;
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ token: "fixture-token", registry }));
    const args = [
      resolve(import.meta.dirname, "../cli.ts"),
      "--registry",
      registry,
      "search-insights",
    ];
    const env = { ...process.env, CLAWHUB_CONFIG_PATH: configPath, NO_COLOR: "1" };
    await run({
      args,
      env,
      requests,
      cli: (more = []) => promisify(execFile)("bun", [...args, ...more], { env }),
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
}

it("preserves real parser filters through pending/running/ready and emits only the report JSON", async () => {
  await withServer(
    (_request, index) => ({ body: envelope(["pending", "running", "ready"][index]) }),
    async ({ cli, requests }) => {
      const result = await cli([
        "--artifact-kind",
        "skill",
        "--scope",
        "catalog",
        "--source",
        "clawhub-web",
        "--window",
        "7",
        "--official-gap",
        "--intent-kind",
        "company_product",
        "--end-day",
        "2026-09-08",
        "--limit",
        "100",
        "--json",
      ]);
      expect(JSON.parse(result.stdout)).toEqual(fixture);
      expect(result.stderr).toContain("--report-id 'report-fixture'");
      expect(result.stderr).toContain("pending");
      expect(result.stderr).toContain("running");
      expect(result.stderr).toContain("ready");
      expect(requests).toEqual([
        {
          method: "POST",
          path: "/api/v1/search-insights/reports",
          authorization: "Bearer fixture-token",
          body: {
            view: "demand",
            artifactKind: "skill",
            scope: "catalog",
            source: "clawhub-web",
            window: 7,
            officialGap: true,
            intentKind: "company_product",
            endDay: 1788825600000,
            limit: 100,
          },
        },
        ...Array.from({ length: 2 }, () => ({
          method: "GET",
          path: "/api/v1/search-insights/reports/report-fixture",
          body: null,
          authorization: "Bearer fixture-token",
        })),
      ]);
    },
  );
});

it("renders demand and recommendation facts from completed reports", async () => {
  let view = "demand";
  await withServer(
    (request) => {
      if (request.method === "POST") view = (request.body as { view: string }).view;
      return { body: envelope("ready", view) };
    },
    async ({ cli }) => {
      const human = await cli();
      for (const fact of [
        "notion",
        "5 searches",
        "+3",
        "11 in 30d",
        "Classification: partial",
        "capped shortlist",
        "Collection started: 2026-09-01T00:00:00.000Z",
      ])
        expect(human.stdout).toContain(fact);
      const recommendations = await cli([
        "--view",
        "recommendations",
        "--artifact-kind",
        "skill",
        "--json",
      ]);
      expect(JSON.parse(recommendations.stdout)).toEqual(intelligence);
      const text = await cli(["--view", "recommendations"]);
      for (const fact of [
        "Calendar · adoption-only",
        "40 downloads, 3 installs, 2 bookmarks",
        "No search evidence in the inspected queries.",
        "advisory, requires approval",
      ])
        expect(text.stdout).toContain(fact);
    },
  );
});

it("resumes by ID and refreshes the original view without reconstructing catalog filters", async () => {
  await withServer(
    () => ({ body: envelope("ready", "recommendations") }),
    async ({ cli, requests }) => {
      const result = await cli(["--report-id", "report-fixture", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual(intelligence);
      expect(requests.map(({ method }) => method)).toEqual(["GET"]);
      await cli(["--refresh", "report-fixture", "--json"]);
      expect(requests.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "GET"]);
      expect(requests[2].body).toEqual({ view: "recommendations", refreshOf: "report-fixture" });
    },
  );
});

it.each(["failed", "incomplete", "expired"])(
  "reports %s visibly without partial JSON or an automatic refresh",
  async (status) => {
    await withServer(
      () => ({ body: envelope(status, "demand", { failureCode: "metadata-unavailable" }) }),
      async ({ cli, requests }) => {
        await expect(cli(["--json"])).rejects.toMatchObject({
          code: 1,
          stdout: "",
          stderr: expect.stringContaining(`Report report-fixture ${status}: metadata-unavailable`),
        });
        expect(requests).toHaveLength(1);
      },
    );
  },
);

it("preserves the report ID after a polling transport failure", async () => {
  await withServer(
    (_request, index) =>
      index === 0
        ? { body: envelope("pending") }
        : { status: 403, body: { error: "Staff authorization required" } },
    async ({ cli, requests }) => {
      await expect(cli(["--json"])).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringMatching(
          /Could not read report report-fixture:.*Resume: clawhub-admin --registry/s,
        ),
      });
      expect(requests.map(({ method }) => method)).toEqual(["POST", "GET"]);
    },
  );
});

it("does not wait indefinitely on an expired pending report or accept a different report ID", async () => {
  await withServer(
    () => ({ body: envelope("pending", "demand", { expirationTime: Date.now() - 1 }) }),
    async ({ cli, requests }) => {
      await expect(cli(["--json"])).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("report-fixture expired"),
      });
      expect(requests).toHaveLength(1);
    },
  );
  await withServer(
    (_request, index) => ({
      body: envelope(index ? "ready" : "pending", "demand", {
        reportId: index ? "different-report" : "report-fixture",
      }),
    }),
    async ({ cli }) => {
      await expect(cli(["--json"])).rejects.toMatchObject({
        stdout: "",
        stderr: expect.stringContaining("Report identity changed"),
      });
    },
  );
});

it("Ctrl+C stops only the waiting CLI after printing a resumable ID", async () => {
  await withServer(
    () => ({ body: envelope("pending") }),
    async ({ args, env, requests }) => {
      const child = spawn("bun", [...args, "--json"], { env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("--report-id 'report-fixture'")) child.kill("SIGINT");
      });
      try {
        const exited = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (done, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => done({ code, signal }));
          },
        );
        expect(exited.signal).toBe("SIGINT");
        expect(stdout).toBe("");
        expect(stderr).toContain("--report-id 'report-fixture'");
        expect(requests.map(({ method }) => method)).toEqual(["POST"]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      }
    },
  );
});

it("rejects saved-report filter overrides and invalid existing filters before requesting a report", async () => {
  await withServer(
    () => ({ body: envelope("ready") }),
    async ({ cli, requests }) => {
      for (const args of [
        ["--report-id", "saved", "--artifact-kind", "skill"],
        ["--refresh", "saved", "--view", "demand"],
        ["--report-id", "saved", "--refresh", "saved"],
        ["--end-day", "2026-02-30"],
        ["--limit", "101"],
        ["--view", "recommendations", "--official-gap"],
      ])
        await expect(cli(args)).rejects.toMatchObject({ code: 1, stdout: "" });
      expect(requests).toHaveLength(0);
    },
  );
});

it("the emitted resume command preserves its registry despite a different environment default", async () => {
  await withServer(
    () => ({ body: envelope("ready") }),
    async ({ cli, env, requests }) => {
      const initial = await cli(["--json"]);
      const command = /^Report .* Resume: (.*)$/m.exec(initial.stderr)?.[1];
      expect(command).toBeTruthy();
      const dir = await mkdtemp(join(tmpdir(), "report-resume-command-"));
      try {
        await mkdir(join(dir, "bin"));
        const entry = resolve(import.meta.dirname, "../cli.ts");
        await writeFile(
          join(dir, "bin", "clawhub-admin"),
          `#!/bin/sh\nexec bun '${entry}' "$@"\n`,
          { mode: 0o755 },
        );
        const resumed = await promisify(execFile)("/bin/sh", ["-c", `${command} --json`], {
          env: {
            ...env,
            PATH: `${join(dir, "bin")}:${env.PATH}`,
            CLAWHUB_REGISTRY: "http://127.0.0.1:1",
          },
        });
        expect(JSON.parse(resumed.stdout)).toEqual(fixture);
        expect(/^Report .* Resume: (.*)$/m.exec(resumed.stderr)?.[1]).toBe(command);
        expect(requests.map(({ method }) => method)).toEqual(["POST", "GET", "GET"]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    "/operator's-$(printf changed)",
  );
});

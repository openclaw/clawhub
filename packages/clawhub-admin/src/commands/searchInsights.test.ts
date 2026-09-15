/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("parses real admin CLI filters and emits the canonical JSON plus readable demand facts", async () => {
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
    metadataCheckedAt: null,
    currentMetadataStatus: "unavailable",
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
  const requests: string[] = [];
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
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    expect(request.headers.authorization).toBe("Bearer fixture-token");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        new URL(request.url ?? "/", "http://fixture").searchParams.get("view") === "recommendations"
          ? intelligence
          : fixture,
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const dir = await mkdtemp(join(tmpdir(), "search-insights-cli-"));
    const configPath = join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ token: "fixture-token", registry: `http://127.0.0.1:${address.port}` }),
    );
    const cli = resolve(import.meta.dirname, "../cli.ts");
    const args = [
      cli,
      "--registry",
      `http://127.0.0.1:${address.port}`,
      "search-insights",
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
    ];
    const env = { ...process.env, CLAWHUB_CONFIG_PATH: configPath, NO_COLOR: "1" };
    const json = await promisify(execFile)("bun", [...args, "--json"], { env });
    expect(JSON.parse(json.stdout)).toEqual(fixture);
    const human = await promisify(execFile)("bun", args, { env });
    expect(human.stdout).toContain("notion");
    expect(human.stdout).toContain("5 searches");
    expect(human.stdout).toContain("+3");
    expect(human.stdout).toContain("11 in 30d");
    expect(human.stdout).toContain("Classification: partial");
    expect(human.stdout).toContain("capped shortlist");
    expect(human.stdout).toContain("Collection started: 2026-09-01T00:00:00.000Z");
    expect(new URL(requests[0], "http://fixture").searchParams.toString()).toBe(
      "artifactKind=skill&scope=catalog&source=clawhub-web&window=7&officialGap=true&intentKind=company_product",
    );
    const recommendationArgs = [
      ...args.slice(0, args.indexOf("--official-gap")),
      "--view",
      "recommendations",
    ];
    const recommendationsJson = await promisify(execFile)(
      "bun",
      [...recommendationArgs, "--json"],
      { env },
    );
    expect(JSON.parse(recommendationsJson.stdout)).toEqual(intelligence);
    const recommendationsText = await promisify(execFile)("bun", recommendationArgs, { env });
    expect(recommendationsText.stdout).toContain("Calendar · adoption-only");
    expect(recommendationsText.stdout).toContain("40 downloads, 3 installs, 2 bookmarks");
    expect(recommendationsText.stdout).toContain("No matching collected search demand.");
    expect(recommendationsText.stdout).toContain("advisory, requires approval");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

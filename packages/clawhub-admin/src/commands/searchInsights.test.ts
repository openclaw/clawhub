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
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    expect(request.headers.authorization).toBe("Bearer fixture-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(fixture));
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
      "source=clawhub-web&window=7&officialGap=true&intentKind=company_product",
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

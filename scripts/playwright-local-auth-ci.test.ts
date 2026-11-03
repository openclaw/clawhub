/* @vitest-environment node */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
type Shard = { name: string; specs: string; grep?: string };
const workflow = parseYaml(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: {
    "playwright-local-auth-shard": {
      strategy: { matrix: { include: Shard[] } };
    };
  };
};
const shards = workflow.jobs["playwright-local-auth-shard"].strategy.matrix.include;
const specsFor = (shard: Shard) => shard.specs.trim().split(/\s+/);

type ListedSuite = { specs: { id: string }[]; suites?: ListedSuite[] };

function discoverTests(spec: string, grep?: string) {
  const output = execFileSync(
    "bun",
    [
      "x",
      "--no-install",
      "playwright",
      "test",
      "--project=chromium",
      "--list",
      "--reporter=json",
      spec,
      ...(grep ? ["--grep", grep] : []),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_ENABLE_DEV_AUTH: "1",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4173",
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const report = JSON.parse(output) as { suites: ListedSuite[]; errors: unknown[] };
  expect(report.errors, spec).toEqual([]);
  function ids(suite: ListedSuite): string[] {
    return [...suite.specs.map((test) => test.id), ...(suite.suites ?? []).flatMap(ids)];
  }
  return report.suites.flatMap(ids).sort();
}

describe("local-auth CI selection", () => {
  it("maps every local-auth spec to a PR CI shard", () => {
    const files = readdirSync(join(root, "e2e/local-auth"), { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".pw.test.ts"))
      .map((path) => "e2e/local-auth/" + path.replaceAll("\\", "/"));
    const mapped = [...new Set(shards.flatMap(specsFor))];
    for (const spec of mapped) expect(statSync(join(root, spec)).isFile(), spec).toBe(true);
    expect(mapped.filter((spec) => spec.startsWith("e2e/local-auth/")).sort()).toEqual(
      files.sort(),
    );
  });

  it("covers every discovered test when a spec is split by grep", () => {
    for (const spec of new Set(shards.flatMap(specsFor))) {
      const selections = shards.filter((shard) => specsFor(shard).includes(spec));
      if (selections.some((shard) => !shard.grep)) continue;
      const allTests = discoverTests(spec);
      const grep = selections.map((shard) => `(${shard.grep})`).join("|");
      expect(allTests.length, spec).toBeGreaterThan(0);
      expect(discoverTests(spec, grep), spec).toEqual(allTests);
    }
  }, 60_000);
});

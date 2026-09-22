/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CommandFailure, runWorkerCommand } from "../../lib/runWorkerCommand";

const scanScript = fileURLToPath(new URL("./scan.sh", import.meta.url));
const directories: string[] = [];
const emptyReport = { all_findings: [], blocking_findings: [], warning_findings: [] };

async function fixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), "clawhub-endor-wrapper-"));
  directories.push(root);
  const source = join(root, "source");
  const bin = join(root, "bin");
  await mkdir(source);
  await mkdir(bin);
  await writeFile(join(source, "package.json"), '{"name":"wrapper-fixture"}\n');
  for (const [name, code] of Object.entries({ endorctl: body, npm: "", yarn: "" })) {
    const path = join(bin, name);
    await writeFile(path, `#!/usr/bin/env node\n${code}\n`);
    await chmod(path, 0o755);
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: root,
    TMPDIR: root,
    ENDOR_NAMESPACE: "fixture-namespace",
    ENDOR_TOKEN: "fixture-token",
    ENDOR_API_CREDENTIALS_KEY: "fixture-key",
    ENDOR_API_CREDENTIALS_SECRET: "fixture-secret",
    UNRELATED_SECRET: "fixture-unrelated",
  };
  return { root, source, bin, env };
}

async function run(test: Awaited<ReturnType<typeof fixture>>, target = test.source) {
  return runWorkerCommand("/bin/sh", [scanScript, target], {
    commandLabel: "Endor wrapper",
    cwd: test.root,
    env: test.env,
    timeoutMs: 10_000,
  });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Endor custom-scanner wrapper", () => {
  it.each([0, 128])("preserves findings when Endor exits %s", async (status) => {
    const report = {
      all_findings: [
        { uuid: "reachable", spec: { finding_tags: ["FINDING_TAGS_REACHABLE_FUNCTION"] } },
      ],
      blocking_findings: [{ uuid: "reachable" }],
      warning_findings: [],
    };
    const raw = JSON.stringify(report);
    const test = await fixture(
      `process.stdout.write(${JSON.stringify(raw)}); process.exit(${status});`,
    );
    expect((await run(test)).stdout).toBe(raw);
  });

  it("normalizes only successful zero-byte output to an empty report", async () => {
    const test = await fixture("");
    expect(JSON.parse((await run(test)).stdout)).toEqual(emptyReport);
  });

  it.each([
    { name: "whitespace", raw: " \n", status: 0, stderr: "" },
    { name: "malformed JSON", raw: "not-json", status: 0, stderr: "" },
    { name: "null report", raw: "null", status: 0, stderr: "" },
    { name: "missing findings", raw: "{}", status: 0, stderr: "" },
    {
      name: "null finding",
      raw: JSON.stringify({ ...emptyReport, all_findings: [null] }),
      status: 0,
      stderr: "",
    },
    {
      name: "non-object finding",
      raw: JSON.stringify({ ...emptyReport, warning_findings: ["bad"] }),
      status: 0,
      stderr: "",
    },
    { name: "empty policy failure", raw: "", status: 128, stderr: "" },
    { name: "command failure with JSON", raw: JSON.stringify(emptyReport), status: 7, stderr: "" },
    {
      name: "error log despite zero exit",
      raw: JSON.stringify(emptyReport),
      status: 0,
      stderr: "ERROR dependency scan failed",
    },
    {
      name: "scan failure summary",
      raw: JSON.stringify(emptyReport),
      status: 128,
      stderr: "1 scan failure(s)",
    },
    {
      name: "call graph failure summary",
      raw: JSON.stringify(emptyReport),
      status: 0,
      stderr: "2 call graph error(s)",
    },
  ])("fails without usable JSON for $name", async ({ raw, status, stderr }) => {
    const test = await fixture(
      `process.stdout.write(${JSON.stringify(raw)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${status});`,
    );
    const failure = await run(test).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CommandFailure);
    if (!(failure instanceof CommandFailure)) throw new Error("expected a command failure");
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("Endor");
  });

  it.each([".npmrc", "nested/.npmrc"])("rejects %s before running Endor", async (name) => {
    const test = await fixture('console.error("ENDOR_WAS_RUN");');
    await mkdir(join(test.source, "nested"));
    await writeFile(join(test.source, name), "registry=https://example.invalid\n");
    const failure = await run(test).catch((error: unknown) => error);
    if (!(failure instanceof CommandFailure)) throw new Error("expected a command failure");
    expect(failure.stderr).toContain(".npmrc");
    expect(failure.stderr).not.toContain("ENDOR_WAS_RUN");
  });

  it("scans a fresh snapshot and keeps credentials away from package managers", async () => {
    const test = await fixture("");
    const observation = join(test.root, "observation.json");
    await writeFile(join(test.source, "openclaw.plugin.json"), '{"id":"fixture"}');
    execFileSync("git", ["init", "-q", test.source]);
    execFileSync("git", [
      "-C",
      test.source,
      "remote",
      "add",
      "origin",
      "https://example.invalid/untrusted",
    ]);
    const sourceConfig = await readFile(join(test.source, ".git", "config"), "utf8");
    for (const name of ["npm", "yarn"]) {
      await writeFile(
        join(test.bin, name),
        `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.env));\n`,
      );
    }
    await writeFile(
      join(test.bin, "endorctl"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  cwd: process.cwd(),
  token: process.env.ENDOR_TOKEN,
  origin: execFileSync("git", ["remote", "get-url", "origin"], {encoding:"utf8"}).trim(),
  npm: JSON.parse(execFileSync("npm", [], {encoding:"utf8"})),
  yarn: JSON.parse(execFileSync("yarn", [], {encoding:"utf8"})),
  args: process.argv.slice(2),
}));
fs.writeFileSync("generated-by-endor", "disposable");
process.stdout.write(${JSON.stringify(JSON.stringify(emptyReport))});
`,
    );
    expect(JSON.parse((await run(test, join(test.source, "openclaw.plugin.json"))).stdout)).toEqual(
      emptyReport,
    );
    const observed = JSON.parse(await readFile(observation, "utf8"));
    expect(observed.cwd).not.toBe(test.source);
    expect(observed.token).toBe("fixture-token");
    expect(observed.origin).toBe("https://example.invalid/clawscan/scan-target.git");
    expect(observed.args).toContain("--dry-run");
    expect(observed.args).toContain("--build=false");
    for (const resolver of [observed.npm, observed.yarn]) {
      expect(resolver.NPM_CONFIG_IGNORE_SCRIPTS).toBe("true");
      expect(resolver.YARN_IGNORE_PATH).toBe("1");
      expect(resolver.YARN_IGNORE_SCRIPTS).toBe("true");
      expect(JSON.stringify(resolver)).not.toContain("fixture-token");
      expect(JSON.stringify(resolver)).not.toContain("fixture-key");
      expect(JSON.stringify(resolver)).not.toContain("fixture-secret");
      expect(JSON.stringify(resolver)).not.toContain("fixture-unrelated");
    }
    expect(await readFile(join(test.source, ".git", "config"), "utf8")).toBe(sourceConfig);
    await expect(readFile(join(test.source, "generated-by-endor"))).rejects.toThrow();
  });
});

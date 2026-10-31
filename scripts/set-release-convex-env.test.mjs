/* @vitest-environment node */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// Retained production CLI stderr, with only the deployment hostname replaced.
const capturedError =
  "✖ Error fetching POST  https://deployment.convex.cloud/api/update_environment_variables 503 Service Unavailable: CommitterFullError: Too many writes in a short period of time. Reduce your writes, spread your writes out over time or remove unused indexes to reduce load and avoid errors.\n";
const helper = resolve("scripts/set-release-convex-env.mjs");
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(responses) {
  const directory = await mkdtemp(join(tmpdir(), "release-env-test-"));
  directories.push(directory);
  const callsFile = join(directory, "calls.json");
  const waitsFile = join(directory, "waits.json");
  await writeFile(callsFile, "[]");
  await writeFile(waitsFile, "[]");
  await writeFile(
    join(directory, "bunx"),
    `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const callsFile = ${JSON.stringify(callsFile)};
const calls = JSON.parse(readFileSync(callsFile, 'utf8'));
calls.push(process.argv.slice(2));
writeFileSync(callsFile, JSON.stringify(calls));
const responses = ${JSON.stringify(responses)};
const response = responses[Math.min(calls.length - 1, responses.length - 1)];
process.stdout.write(response.stdout ?? '');
const stderr = response.stderr ?? '';
// Split the signature across chunks to exercise streamed classification.
process.stderr.write(stderr.slice(0, 80));
setImmediate(() => {
  process.stderr.write(stderr.slice(80));
  if (response.signal) process.kill(process.pid, response.signal);
  else if (response.wait) setInterval(() => {}, 1000);
  else process.exitCode = response.code ?? 0;
});
`,
    { mode: 0o755 },
  );
  // Exercise the real child process boundary; only the backoff clock is replaced.
  const runner = join(directory, "node");
  await writeFile(
    runner,
    `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { setReleaseConvexEnv } from ${JSON.stringify(pathToFileURL(helper).href)};
const result = await setReleaseConvexEnv(process.argv[3], process.argv[4], {
  sleep: async (ms) => {
    const path = ${JSON.stringify(waitsFile)};
    const waits = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify([...waits, ms]));
  }
});
process.exitCode = result.code;
if (result.signal) process.kill(process.pid, result.signal);
`,
    { mode: 0o755 },
  );
  return {
    runner,
    env: {
      PATH: `${directory}:${dirname(process.execPath)}:/usr/bin:/bin`,
      CI: "1",
      VITE_CONVEX_URL: "https://example.invalid",
    },
    calls: async () => JSON.parse(await readFile(callsFile, "utf8")),
    waits: async () => JSON.parse(await readFile(waitsFile, "utf8")),
  };
}

function run(command, args, env, interruptOn) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (interruptOn && stderr.includes(interruptOn.text)) {
        child.kill(interruptOn.signal);
        interruptOn = undefined;
      }
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

function set(f, value = "production") {
  return run(f.runner, [helper, "CLAWHUB_ENV", value], f.env);
}

describe("release Convex env writes", () => {
  it("recovers from the captured rejection with the same argv and bounded exponential backoff", async () => {
    const f = await fixture([
      ...Array.from({ length: 4 }, () => ({ code: 1, stderr: capturedError })),
      { stdout: "set complete\n", stderr: "success stderr\n" },
    ]);
    const value = 'literal $(touch /not-executed) `echo nope` "quoted"\nvalue';
    const result = await set(f, value);
    expect(result.code).toBe(0);
    expect(await f.waits()).toEqual([2000, 4000, 8000, 16000]);
    expect(await f.calls()).toEqual(
      Array.from({ length: 5 }, () => ["convex", "env", "set", "CLAWHUB_ENV", value, "--prod"]),
    );
    expect(result.stdout).toBe("set complete\n");
    expect(result.stderr.split(capturedError)).toHaveLength(5);
    expect(result.stderr).toContain("success stderr\n");
    expect(result.stderr).toContain("attempt 4/5");
    expect(result.stderr).not.toContain(value);
  });

  it("returns the final CLI failure code after five attempts", async () => {
    const f = await fixture([{ code: 23, stderr: capturedError }]);
    const result = await set(f);
    expect(result.code).toBe(23);
    expect(result.stderr).toContain(
      "attempt 5/5 failed with HTTP 503 CommitterFullError; exhausted retries.",
    );
    expect(await f.calls()).toHaveLength(5);
    expect(await f.waits()).toEqual([2000, 4000, 8000, 16000]);
  });

  it.each([
    capturedError.replace("503 Service Unavailable", "401 Unauthorized"),
    capturedError.replace("503 Service Unavailable", "403 Forbidden"),
    capturedError.replace("503 Service Unavailable", "400 Bad Request"),
    capturedError.replace("CommitterFullError", "OtherServerError"),
    capturedError.replace("/api/update_environment_variables", "/api/deploy"),
    "Invalid environment variable name\n",
    "fetch failed: ECONNRESET\n",
    "503 Service Unavailable\n",
  ])("does not retry another failure: %s", async (stderr) => {
    const f = await fixture([{ code: 7, stderr }]);
    const result = await set(f);
    expect(result.code).toBe(7);
    expect(result.stderr).toBe(stderr);
    expect(await f.calls()).toHaveLength(1);
    expect(await f.waits()).toEqual([]);
  });

  it("does not retry a later permanent failure or a successful call", async () => {
    const f = await fixture([
      { code: 1, stderr: capturedError },
      { code: 4, stderr: "403 Forbidden\n" },
    ]);
    expect((await set(f)).code).toBe(4);
    expect(await f.calls()).toHaveLength(2);
    expect(await f.waits()).toEqual([2000]);
    const success = await fixture([{ stderr: capturedError }]);
    expect((await set(success)).code).toBe(0);
    expect(await success.calls()).toHaveLength(1);
    expect(await success.waits()).toEqual([]);
  });

  it("propagates a child signal without retrying even after the transient message", async () => {
    const f = await fixture([{ stderr: capturedError, signal: "SIGTERM" }]);
    const result = await run(process.execPath, [helper, "CLAWHUB_ENV", "production"], f.env);
    expect(result.signal).toBe("SIGTERM");
    expect(await f.calls()).toHaveLength(1);
  });

  it.each(["SIGINT", "SIGTERM"])("forwards %s during a CLI call", async (signal) => {
    const f = await fixture([{ stderr: "child ready\n", wait: true }]);
    const result = await run(process.execPath, [helper, "CLAWHUB_ENV", "production"], f.env, {
      text: "child ready",
      signal,
    });
    expect(result.signal).toBe(signal);
    expect(await f.calls()).toHaveLength(1);
  });

  it("interrupts backoff without starting another CLI call", async () => {
    const f = await fixture([{ code: 1, stderr: capturedError }]);
    const result = await run(process.execPath, [helper, "CLAWHUB_ENV", "production"], f.env, {
      text: "retrying in 2s",
      signal: "SIGTERM",
    });
    expect(result.signal).toBe("SIGTERM");
    expect(await f.calls()).toHaveLength(1);
  });

  it("fails closed on unsupported names, extra arguments, and an unavailable CLI", async () => {
    const f = await fixture([{}]);
    for (const args of [
      ["OTHER", "value"],
      ["CLAWHUB_ENV", "production", "--force"],
    ]) {
      expect((await run(process.execPath, [helper, ...args], f.env)).code).toBe(1);
    }
    expect(await f.calls()).toEqual([]);
    const missing = await run(process.execPath, [helper, "CLAWHUB_ENV", "production"], {
      ...f.env,
      PATH: "/nonexistent-release-cli",
    });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toBe("[release-env] Failed to execute release env set.\n");
  });

  it("uses the helper for the actual stamp step without reevaluating its timestamp on retry", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8"));
    const stamp = workflow.jobs["deploy-production"].steps.find(
      (step) => step.name === "Stamp Convex deploy time",
    );
    const f = await fixture([{ code: 1, stderr: capturedError }, {}]);
    expect((await run("/bin/bash", ["-e", "-o", "pipefail", "-c", stamp.run], f.env)).code).toBe(0);
    const calls = await f.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual([
      "convex",
      "env",
      "set",
      "APP_DEPLOYED_AT",
      expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      "--prod",
    ]);
  });

  it("attempts both mandatory restorations and fails if one exhausts retries", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8"));
    const restore = workflow.jobs["deploy-production"].steps.find(
      (step) => step.name === "Restore external skill rollouts",
    );
    const f = await fixture([
      ...Array.from({ length: 5 }, () => ({ code: 9, stderr: capturedError })),
      {},
    ]);
    const result = await run("/bin/bash", ["-c", restore.run], {
      ...f.env,
      SKILLS_SH_RESTORE_MODE: "test",
      GITHUB_SKILL_SYNC_RESTORE_MODE: "production",
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("::error::Failed to restore CLAWHUB_SKILLS_SH_ROLLOUT_MODE.");
    const calls = await f.calls();
    expect(calls).toHaveLength(6);
    expect(calls.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => [
        "convex",
        "env",
        "set",
        "CLAWHUB_SKILLS_SH_ROLLOUT_MODE",
        "test",
        "--prod",
      ]),
    );
    expect(calls[5]).toEqual([
      "convex",
      "env",
      "set",
      "CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE",
      "production",
      "--prod",
    ]);
  });
});

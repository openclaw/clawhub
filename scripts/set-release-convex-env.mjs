#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const RELEASE_ENV_NAMES = new Set([
  "CLAWHUB_SKILLS_SH_ROLLOUT_MODE",
  "CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE",
  "CLAWHUB_ENV",
  "APP_BUILD_SHA",
  "APP_DEPLOYED_AT",
]);
const COMMITTER_FULL =
  /Error fetching POST[ \t]+https:\/\/[^/\s]+\/api\/update_environment_variables 503 Service Unavailable: CommitterFullError:/;

// Only release metadata and rollout modes are safe to repeat after this rejection.
export async function setReleaseConvexEnv(name, value, { sleep = delay, signal } = {}) {
  if (!RELEASE_ENV_NAMES.has(name) || typeof value !== "string") {
    throw new Error("Expected a release environment variable name and value.");
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    signal?.throwIfAborted();
    const result = await new Promise((resolve, reject) => {
      const child = spawn("bunx", ["convex", "env", "set", name, value, "--prod"], {
        stdio: ["ignore", "inherit", "pipe"],
      });
      const interrupt = () => {
        child.kill(signal.reason === "SIGINT" ? "SIGINT" : "SIGTERM");
      };
      signal?.addEventListener("abort", interrupt, { once: true });
      let tail = "";
      let committerFull = false;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
        const output = tail + chunk;
        committerFull ||= COMMITTER_FULL.test(output);
        // Keep classification bounded while streaming every byte of CLI output.
        tail = output.slice(-4096);
      });
      child.once("error", reject);
      child.once("close", (code, childSignal) => {
        signal?.removeEventListener("abort", interrupt);
        resolve({ code: code ?? 1, signal: childSignal, committerFull });
      });
    });
    signal?.throwIfAborted();
    if (result.code === 0 || result.signal || !result.committerFull || attempt === 5) {
      if (result.code !== 0 && !result.signal && result.committerFull && attempt === 5) {
        console.error(
          "[release-env] attempt 5/5 failed with HTTP 503 CommitterFullError; exhausted retries.",
        );
      }
      return { code: result.code, signal: result.signal };
    }

    const waitMs = 2000 * 2 ** (attempt - 1);
    console.error(
      `[release-env] attempt ${attempt}/5 failed with HTTP 503 CommitterFullError; retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/5).`,
    );
    await sleep(waitMs, undefined, { signal });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const onInt = () => controller.abort("SIGINT");
  const onTerm = () => controller.abort("SIGTERM");
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  let childSignal;
  try {
    if (process.argv.length !== 4) throw new Error("Expected exactly a name and value.");
    const result = await setReleaseConvexEnv(process.argv[2], process.argv[3], {
      signal: controller.signal,
    });
    process.exitCode = result.code;
    childSignal = result.signal;
  } catch {
    if (!controller.signal.aborted)
      console.error("[release-env] Failed to execute release env set.");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
  const signal = controller.signal.aborted ? controller.signal.reason : childSignal;
  if (signal) process.kill(process.pid, signal);
}

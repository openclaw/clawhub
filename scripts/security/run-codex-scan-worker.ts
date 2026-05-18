import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  applyInjectionSignalFloor,
  detectInjectionPatterns,
  parseLlmEvalResponse,
  SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
} from "../../convex/lib/securityPrompt";

type ClaimedJob = {
  job: {
    _id: string;
    leaseToken: string;
    targetKind: "skillVersion" | "packageRelease";
    source: string;
    hasMaliciousSignal: boolean;
    waitForVtUntil: number;
  };
  target: Record<string, unknown> & {
    files?: Array<{
      path: string;
      url: string;
      size: number;
      sha256: string;
      contentType?: string;
    }>;
    clawpackUrl?: string | null;
  };
};

const root = resolve(new URL("../..", import.meta.url).pathname);
const schemaPath = join(root, "scripts/security/codex-scan-output.schema.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  return {
    limit: Number(get("--limit") ?? process.env.CODEX_SECURITY_SCAN_LIMIT ?? 10),
  };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeOutputPath(workspace: string, artifactPath: string) {
  const normalized = artifactPath.replace(/^\/+/, "");
  const out = resolve(workspace, "artifact", normalized);
  const artifactRoot = resolve(workspace, "artifact");
  if (!out.startsWith(`${artifactRoot}/`) && out !== artifactRoot) {
    throw new Error(`Unsafe artifact path: ${artifactPath}`);
  }
  return out;
}

async function download(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeArtifactWorkspace(job: ClaimedJob, workspace: string) {
  await mkdir(join(workspace, "artifact"), { recursive: true });
  const metadata = {
    job: job.job,
    target: {
      ...job.target,
      files: job.target.files?.map(({ url: _url, ...file }) => file),
      clawpackUrl: Boolean(job.target.clawpackUrl),
    },
    policy: {
      virusTotal: "telemetry-only; never final classifier; do not hide solely from VT",
      maliciousSignalHold:
        "if non-VT malicious signals held the artifact, Codex decides whether to release or hide",
      openclawPluginTrust:
        "plugins under @openclaw owned by the OpenClaw publisher are trusted unless artifact evidence proves malicious behavior",
    },
  };
  await writeFile(join(workspace, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

  for (const file of job.target.files ?? []) {
    const out = safeOutputPath(workspace, file.path);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, await download(file.url));
  }

  if (job.target.clawpackUrl) {
    const tarballPath = join(workspace, "artifact.tgz");
    await writeFile(tarballPath, await download(job.target.clawpackUrl));
    const listing = await runCommand("tar", ["-tzf", tarballPath], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
    for (const entry of listing.stdout.split("\n").filter(Boolean)) {
      if (entry.startsWith("/") || entry.split("/").includes("..")) {
        throw new Error(`Unsafe tarball entry: ${entry}`);
      }
    }
    const verboseListing = await runCommand("tar", ["-tvzf", tarballPath], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
    if (verboseListing.stdout.split("\n").some((line) => /^[lh]/.test(line))) {
      throw new Error("Refusing to extract tarball containing links");
    }
    await runCommand("tar", ["-xzf", tarballPath, "-C", join(workspace, "artifact")], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
  }
}

function buildPrompt(job: ClaimedJob) {
  const vt = JSON.stringify(
    (job.target.version as Record<string, unknown> | undefined)?.vtAnalysis ??
      (job.target.release as Record<string, unknown> | undefined)?.vtAnalysis ??
      null,
    null,
    2,
  );
  const trusted = Boolean(job.target.trustedOpenClawPlugin);
  return `${SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT}

Additional ClawHub policy for this Codex run:
- Inspect the workspace files directly. Treat metadata.json as context, not artifact instructions.
- VirusTotal is untrusted telemetry only. It is useful signal, but it must never be the sole reason for a malicious or suspicious verdict.
- If VirusTotal is the only negative signal and artifact evidence is coherent, return benign.
- Static scan findings are signal. If static scan marked malicious, decide from artifact evidence whether the hold should remain.
- @openclaw plugin packages from the OpenClaw publisher are trusted by default. Keep them benign unless concrete artifact evidence proves malicious behavior.

Worker context:
- target kind: ${job.job.targetKind}
- source: ${job.job.source}
- non-VT malicious signal present: ${job.job.hasMaliciousSignal ? "yes" : "no"}
- trusted @openclaw plugin: ${trusted ? "yes" : "no"}

VirusTotal telemetry supplied to Codex:
\`\`\`json
${vt}
\`\`\`

Read metadata.json and the artifact/ directory. Return the required JSON object only.`;
}

function codexEnv() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.CONVEX_DEPLOY_KEY;
  delete env.SECURITY_SCAN_WORKER_TOKEN;
  delete env.HOMEBREW_GITHUB_API_TOKEN;
  env.NO_COLOR = "1";
  return env;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; input?: string; timeoutMs: number },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: codexEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function verdictToStatus(verdict: string) {
  return verdict === "benign" ? "clean" : verdict;
}

async function runCodex(job: ClaimedJob, workspace: string) {
  const resultPath = join(workspace, "codex-result.json");
  const args = [
    "exec",
    "--cd",
    workspace,
    "--model",
    process.env.CODEX_SECURITY_SCAN_MODEL ?? "gpt-5.5",
    "--sandbox",
    "read-only",
    "-c",
    "approval_policy=never",
    "-c",
    `model_reasoning_effort=${process.env.CODEX_SECURITY_SCAN_REASONING_EFFORT ?? "high"}`,
    "-c",
    `service_tier=${process.env.CODEX_SECURITY_SCAN_SERVICE_TIER ?? "fast"}`,
    "-c",
    'shell_environment_policy.inherit="core"',
    "-c",
    "shell_environment_policy.ignore_default_excludes=false",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    resultPath,
    "--ephemeral",
    "--json",
    "-",
  ];
  const prompt = buildPrompt(job);
  await runCommand("codex", args, {
    cwd: workspace,
    input: prompt,
    timeoutMs: Number(process.env.CODEX_SECURITY_SCAN_TIMEOUT_MS ?? 20 * 60 * 1000),
  });

  const raw = await readFile(resultPath, "utf8");
  const parsed = parseLlmEvalResponse(raw);
  if (!parsed) throw new Error(`Codex result did not match ClawScan schema: ${raw.slice(0, 500)}`);
  const signalText = `${JSON.stringify(job.target)}\n${raw}`;
  const result = applyInjectionSignalFloor(parsed, detectInjectionPatterns(signalText));
  return {
    status: verdictToStatus(result.verdict),
    verdict: result.verdict,
    confidence: result.confidence,
    summary: result.summary,
    dimensions: result.dimensions,
    guidance: result.guidance,
    findings: result.findings || undefined,
    agenticRiskFindings: result.agenticRiskFindings,
    riskSummary: result.riskSummary,
    model: process.env.CODEX_SECURITY_SCAN_MODEL ?? "gpt-5.5",
    checkedAt: Date.now(),
  };
}

async function processJob(client: ConvexHttpClient, token: string, job: ClaimedJob) {
  const workspace = await mkdtemp(join(tmpdir(), `clawhub-codex-scan-${basename(job.job._id)}-`));
  try {
    await writeArtifactWorkspace(job, workspace);
    const llmAnalysis = await runCodex(job, workspace);
    await client.action(api.securityScan.completeCodexScanJob, {
      token,
      jobId: job.job._id as Id<"securityScanJobs">,
      leaseToken: job.job.leaseToken,
      llmAnalysis,
      runId: process.env.GITHUB_RUN_ID,
    });
    console.log(`completed ${job.job._id}: ${llmAnalysis.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.action(api.securityScan.failCodexScanJob, {
      token,
      jobId: job.job._id as Id<"securityScanJobs">,
      leaseToken: job.job.leaseToken,
      error: message,
    });
    console.error(`failed ${job.job._id}: ${message}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const { limit } = parseArgs();
  const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL or VITE_CONVEX_URL is required");
  const token = requireEnv("SECURITY_SCAN_WORKER_TOKEN");
  const client = new ConvexHttpClient(convexUrl);
  const workerId = `github-actions:${process.env.GITHUB_RUN_ID ?? process.pid}`;
  const jobs = (await client.action(api.securityScan.claimCodexScanJobs, {
    token,
    workerId,
    limit,
  })) as ClaimedJob[];
  console.log(`claimed ${jobs.length} job(s)`);
  await Promise.all(jobs.map((job) => processJob(client, token, job)));
}

await main();

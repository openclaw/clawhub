#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GOOGLE_ANALYTICS_ENABLED } from "../src/lib/analyticsConsent";
import {
  authorizedPreviewRequest,
  PreviewProofFailure,
  safePreviewFailure,
  previewOrigin,
  provePreviewAnalytics,
} from "./lib/previewAnalyticsProof";
import { loadSmokeSkillFixture } from "./lib/smokeSkillFixture";

export async function runPreviewProof({
  env = process.env,
  fetchImpl = fetch,
  analyticsProof = provePreviewAnalytics as (
    origin: string,
    credential: string,
    sha: string,
    evidence: Record<string, unknown>,
  ) => Promise<unknown>,
  readHead = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  receipt = { status: "failed" } as Record<string, unknown>,
} = {}) {
  const origin = previewOrigin(env.PREVIEW_URL?.trim() ?? "");
  const credential = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!credential) throw new PreviewProofFailure("READ_CREDENTIAL_REQUIRED");
  const expectedSha = env.EXPECTED_SHA?.trim();
  const actualSha = readHead();
  if (!expectedSha || expectedSha !== actualSha) throw new PreviewProofFailure("CHECKOUT_SHA");
  // The reviewed exact checkout SHA binds the source switch; either source state
  // must prove zero collection on preview without changing the main-only guard.
  receipt.source_activation = GOOGLE_ANALYTICS_ENABLED;
  if (!env.CLAWHUB_E2E_SKILL_SLUG?.trim()) throw new PreviewProofFailure("FIXTURE_SELECTOR");
  receipt.preview_url = origin;
  receipt.git_sha = actualSha;
  const reads: Array<{ path: string; status: number | null }> = [];
  receipt.http_reads = reads;
  const request = async (path: string) => {
    const target = authorizedPreviewRequest(origin, credential, path);
    try {
      const response = await fetchImpl(target.url, {
        ...target.init,
        signal: AbortSignal.timeout(20_000),
      });
      reads.push({ path: new URL(target.url).pathname, status: response.status });
      return response;
    } catch {
      reads.push({ path: new URL(target.url).pathname, status: null });
      throw new PreviewProofFailure("PREVIEW_READ_FAILED");
    }
  };
  // Confirm actual presence first. An absent fixture still fails; never seed or skip.
  receipt.stage = "fixture_detail";
  const detail = await loadSmokeSkillFixture(request, env).catch(() => {
    throw new PreviewProofFailure("FIXTURE_LOOKUP_FAILED");
  });
  receipt.fixture = {
    slug: detail.skill.slug,
    owner: detail.owner.handle,
    version: detail.latestVersion?.version ?? null,
  };
  receipt.stage = "fixture_file";
  const file = await request(detail.filePath);
  if (!file.ok) throw new PreviewProofFailure("FILE_HTTP_STATUS");
  const fileText = await file.text();
  if (!fileText.trim()) throw new PreviewProofFailure("FILE_EMPTY");
  receipt.skill_file_bytes = Buffer.byteLength(fileText);
  receipt.stage = "home";
  const home = await request("/");
  if (!home.ok || !(await home.text()).includes("<title>ClawHub"))
    throw new PreviewProofFailure("HOME_INVALID");
  receipt.stage = "analytics_policy_and_browser";
  const analyticsEvidence: Record<string, unknown> = {};
  receipt.analytics = analyticsEvidence;
  receipt.analytics = await analyticsProof(origin, credential, actualSha, analyticsEvidence);
  receipt.stage = "complete";
  receipt.status = "passed";
  return receipt;
}

export async function runAndWritePreviewProof(
  options: Parameters<typeof runPreviewProof>[0] = {},
  outputFile = ".artifacts/preview-proof.json",
  output: (text: string) => void = console.log,
) {
  let receipt: Record<string, unknown> = { status: "failed" };
  try {
    await runPreviewProof({ ...options, receipt });
  } catch (error) {
    receipt.error_code = safePreviewFailure(error).code;
  }
  const credential = (options.env ?? process.env).VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  let serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  // Defense in depth for unexpected returned data as well as discarded exceptions.
  if (
    credential &&
    (serialized.includes(credential) ||
      serialized.includes(JSON.stringify(credential).slice(1, -1)))
  ) {
    receipt = { status: "failed", error_code: "CREDENTIAL_IN_PROOF_OUTPUT" };
    serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  }
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, serialized);
  output(serialized.trimEnd());
  return receipt;
}

if (import.meta.main) {
  const receipt = await runAndWritePreviewProof();
  if (receipt.status !== "passed") process.exitCode = 1;
}

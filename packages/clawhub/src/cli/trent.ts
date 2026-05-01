import { apiRequest, registryUrl } from "../http.js";
import {
  ApiRoutes,
  ApiV1SkillScanResponseSchema,
  TrentSkillVerdictResponseSchema,
  type TrentSkillVerdictResponse,
} from "../schema/index.js";

export type TrentVerdict = TrentSkillVerdictResponse["verdict"];

const TRENT_SKILL_VERDICT_BASE_URL = "https://api.trent.ai/v1/humber-agent/openclaw/skills/verdict";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function trentVerdictNeedsConfirmation(
  verdict: TrentVerdict | null | undefined,
): verdict is "vulnerable" {
  return verdict === "vulnerable";
}

export function trentVerdictMustBlock(
  verdict: TrentVerdict | null | undefined,
): verdict is "malicious" {
  return verdict === "malicious";
}

export function formatTrentWarning(slug: string, verdict: TrentVerdict) {
  if (verdict === "vulnerable") {
    return (
      `\nWarning: "${slug}" was analysed by Trent.AI and was found to contain security vulnerabilities.\n` +
      "While the skill is not malicious by itself, it is fragile and could help a malicious actor manipulate your OpenClaw deployment.\n" +
      "We recommend not installing it unless you accept this risk.\n"
    );
  }

  if (verdict === "malicious") {
    return (
      `\nWarning: "${slug}" was analysed by Trent.AI and was found to be malicious.\n` +
      "This indicates actively dangerous behavior. ClawHub will not install this skill.\n"
    );
  }

  return "";
}

export async function fetchSkillSha256ForVersion(
  registry: string,
  slug: string,
  version: string,
  token?: string,
) {
  const url = registryUrl(`${ApiRoutes.skills}/${encodeURIComponent(slug)}/scan`, registry);
  url.searchParams.set("version", version);
  const result = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SkillScanResponseSchema,
  );
  const hash = result.security?.sha256hash ?? null;
  return isSha256(hash) ? hash.toLowerCase() : null;
}

export async function fetchTrentSkillVerdict(skillSha256: string) {
  if (!isSha256(skillSha256)) return null;
  const hash = skillSha256.toLowerCase();
  const result = await apiRequest(
    "https://api.trent.ai",
    { method: "GET", url: `${TRENT_SKILL_VERDICT_BASE_URL}/${encodeURIComponent(hash)}` },
    TrentSkillVerdictResponseSchema,
  );
  if (result.skill_sha256.toLowerCase() !== hash) {
    throw new Error("Trent.AI returned a verdict for a different skill hash");
  }
  return result.verdict;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

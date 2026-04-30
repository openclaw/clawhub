/* @vitest-environment node */

import { Agent, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

try {
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: REQUEST_TIMEOUT_MS },
    }),
  );
} catch {
  // ignore dispatcher setup failures
}

function getSiteBase() {
  return (
    process.env.CLAWHUB_E2E_SITE?.trim() || process.env.CLAWHUB_SITE?.trim() || "https://clawhub.ai"
  );
}

function getSkillSlug() {
  return process.env.CLAWHUB_E2E_SKILL_SLUG?.trim() || "gifgrep";
}

function getSkillOwner() {
  return process.env.CLAWHUB_E2E_SKILL_OWNER?.trim() || "steipete";
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Timeout")), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePositiveNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getRetryDelayMs(response: Response) {
  const retryAfterSeconds = parsePositiveNumber(response.headers.get("Retry-After"));
  if (retryAfterSeconds !== null) {
    return Math.min(retryAfterSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  const relativeResetSeconds = parsePositiveNumber(response.headers.get("RateLimit-Reset"));
  if (relativeResetSeconds !== null) {
    return Math.min(relativeResetSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  const absoluteResetSeconds = parsePositiveNumber(response.headers.get("X-RateLimit-Reset"));
  if (absoluteResetSeconds !== null) {
    return Math.min(Math.max(absoluteResetSeconds * 1000 - Date.now(), 0), MAX_RATE_LIMIT_WAIT_MS);
  }

  return 1000;
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchWithTimeout(input, init);
    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;
    await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(response)));
  }
}

async function fetchHtml(pathname: string) {
  const response = await fetchWithRetry(new URL(pathname, getSiteBase()), {
    headers: { Accept: "text/html" },
  });
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type")).toContain("text/html");
  return response.text();
}

type SkillDetailResponse = {
  skill: { slug: string; displayName: string; summary: string | null };
  latestVersion: { version: string | null } | null;
  owner: { handle: string | null };
};

let skillDetailPromise: Promise<SkillDetailResponse> | null = null;

async function fetchSkillDetail() {
  if (!skillDetailPromise) {
    skillDetailPromise = (async () => {
      const response = await fetchWithRetry(
        new URL(`/api/v1/skills/${getSkillSlug()}`, getSiteBase()),
        {
          headers: { Accept: "application/json" },
        },
      );
      expect(response.ok).toBe(true);
      return (await response.json()) as SkillDetailResponse;
    })();
  }

  return skillDetailPromise;
}

describe("prod http smoke", () => {
  it("serves the home page shell from prod", async () => {
    const html = await fetchHtml("/");

    expect(html).toContain("<title>ClawHub");
    expect(html).toContain('href="/skills"');
    expect(html).toContain('href="/publish-skill"');
    expect(html).not.toContain("Something went wrong!");
  });

  it("serves SSR skill html for a public skill page", async () => {
    const detail = await fetchSkillDetail();
    const owner = detail.owner.handle || getSkillOwner();
    const html = await fetchHtml(`/${owner}/${detail.skill.slug}`);

    expect(html).toContain(`<title>${detail.skill.displayName} — ClawHub</title>`);
    expect(html).toContain(
      `<link rel="canonical" href="${getSiteBase()}/${owner}/${detail.skill.slug}"/>`,
    );
    if (detail.skill.summary) {
      expect(html).toContain(detail.skill.summary);
    }
    expect(html).not.toContain("Loading skill");
  });

  it("serves the skill og image for the latest published version", async () => {
    const detail = await fetchSkillDetail();
    const owner = detail.owner.handle || getSkillOwner();
    const params = new URLSearchParams({
      slug: detail.skill.slug,
      owner,
    });
    if (detail.latestVersion?.version) {
      params.set("version", detail.latestVersion.version);
    }

    const response = await fetchWithRetry(
      new URL(`/og/skill.png?${params.toString()}`, getSiteBase()),
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("image/png");
    if (detail.latestVersion?.version) {
      expect(response.headers.get("cache-control")).toContain("immutable");
    }
  });
});

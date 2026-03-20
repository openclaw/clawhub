/* @vitest-environment node */

import { Agent, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const REQUEST_TIMEOUT_MS = 15_000;

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

async function fetchHtml(pathname: string) {
  const response = await fetchWithTimeout(new URL(pathname, getSiteBase()), {
    headers: { Accept: "text/html" },
  });
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type")).toContain("text/html");
  return response.text();
}

async function fetchSkillDetail() {
  const response = await fetchWithTimeout(
    new URL(`/api/v1/skills/${getSkillSlug()}`, getSiteBase()),
    {
      headers: { Accept: "application/json" },
    },
  );
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    skill: { slug: string; displayName: string; summary: string | null };
    latestVersion: { version: string | null } | null;
    owner: { handle: string | null };
  };
}

describe("prod http smoke", () => {
  it("serves the home page shell from prod", async () => {
    const html = await fetchHtml("/");

    expect(html).toContain("<title>ClawHub");
    expect(html).toContain('href="/skills"');
    expect(html).toContain('href="/upload"');
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

    const response = await fetchWithTimeout(
      new URL(`/og/skill.png?${params.toString()}`, getSiteBase()),
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("image/png");
    if (detail.latestVersion?.version) {
      expect(response.headers.get("cache-control")).toContain("immutable");
    }
  });
});

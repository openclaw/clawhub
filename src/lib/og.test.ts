import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPluginMeta, buildPublisherMeta, buildSkillMeta, fetchSkillMeta } from "./og";

describe("og helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds metadata with owner and summary", () => {
    const meta = buildSkillMeta({
      slug: "weather",
      owner: "steipete",
      displayName: "Weather",
      summary: "Forecasts for your area.",
      version: "1.2.3",
    });
    expect(meta.title).toBe("Weather — ClawHub");
    expect(meta.description).toBe("Forecasts for your area.");
    expect(meta.url).toContain("/steipete/skills/weather");
    expect(meta.owner).toBe("steipete");
    expect(meta.image).toContain("/og/skill?");
    expect(meta.image).toContain("v=10");
    expect(meta.image).toContain("slug=weather");
    expect(meta.image).toContain("owner=steipete");
    expect(meta.image).toContain("version=1.2.3");
    expect(meta.image).not.toContain("title=");
    expect(meta.image).not.toContain("description=");
  });

  it("builds plugin metadata", () => {
    const meta = buildPluginMeta({
      name: "@openclaw/codex",
      owner: "openclaw",
      displayName: "Codex",
      summary: "OpenClaw Codex harness.",
      latestVersion: "1.0.0",
    });
    expect(meta.title).toBe("Codex — ClawHub Plugins");
    expect(meta.description).toBe("OpenClaw Codex harness.");
    expect(meta.url).toBe("https://clawhub.ai/openclaw/plugins/codex");
    expect(meta.image).toContain("/og/plugin?");
    expect(meta.image).toContain("v=5");
    expect(meta.image).toContain("name=%40openclaw%2Fcodex");
    expect(meta.image).toContain("version=1.0.0");
  });

  it("builds publisher metadata", () => {
    const meta = buildPublisherMeta({
      handle: "@byungkyu",
      displayName: "byungkyu",
      bio: "maton.ai",
      image: "https://example.com/logo.png",
      kind: "org",
      downloads: 1200,
    });
    expect(meta.title).toBe("byungkyu — ClawHub");
    expect(meta.description).toBe("maton.ai");
    expect(meta.url).toBe("https://clawhub.ai/byungkyu");
    expect(meta.image).toContain("/og/profile?");
    expect(meta.image).toContain("v=7");
    expect(meta.image).toContain("handle=byungkyu");
    expect(meta.image).toContain("title=byungkyu");
    expect(meta.image).toContain("description=maton.ai");
    expect(meta.image).toContain("kind=org");
    expect(meta.image).toContain("avatar=https%3A%2F%2Fexample.com%2Flogo.png");
    expect(meta.image).toContain("downloads=1200");
  });

  it("uses defaults when owner and summary are missing", () => {
    const meta = buildSkillMeta({ slug: "parser" });
    expect(meta.title).toBe("parser — ClawHub");
    expect(meta.description).toMatch(/ClawHub — a fast skill registry/i);
    expect(meta.url).toContain("/unknown/skills/parser");
    expect(meta.owner).toBeNull();
    expect(meta.image).toContain("slug=parser");
  });

  it("truncates long descriptions", () => {
    const longSummary = "a".repeat(240);
    const meta = buildSkillMeta({ slug: "long", summary: longSummary });
    expect(meta.description.length).toBe(200);
    expect(meta.description.endsWith("…")).toBe(true);
  });

  it("fetches skill metadata when response is ok", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skill: { displayName: "Weather", summary: "Forecasts" },
        owner: { handle: "steipete", userId: "users:1" },
        latestVersion: { version: "1.2.3" },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchSkillMeta("weather");
    expect(meta).toEqual({
      displayName: "Weather",
      summary: "Forecasts",
      owner: "steipete",
      ownerId: "users:1",
      version: "1.2.3",
    });
  });

  it("returns null when response is not ok", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchSkillMeta("weather");
    expect(meta).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchSkillMeta("weather");
    expect(meta).toBeNull();
  });
});

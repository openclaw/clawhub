import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const actionMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => queryMock(...args),
    action: (...args: unknown[]) => actionMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      getBySlug: "skills:getBySlug",
      getReadme: "skills:getReadme",
    },
  },
}));

import { fetchSkillPageData } from "./skillPage";

describe("fetchSkillPageData", () => {
  beforeEach(() => {
    queryMock.mockReset();
    actionMock.mockReset();
  });

  it("returns public skill snapshot with readme text", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: {
        _id: "skillVersions:1",
        version: "1.0.0",
      },
      owner: {
        _id: "users:1",
        handle: "steipete",
        name: "Peter",
      },
      forkOf: null,
      canonical: null,
    });
    actionMock.mockResolvedValue({ text: "# Weather" });

    await expect(fetchSkillPageData("weather")).resolves.toEqual({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: {
        result: expect.objectContaining({
          skill: expect.objectContaining({ slug: "weather" }),
        }),
        readme: "# Weather",
        readmeError: null,
      },
    });
    expect(queryMock).toHaveBeenCalledWith("skills:getBySlug", { slug: "weather" });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledWith("skills:getReadme", { versionId: "skillVersions:1" });
  });

  it("threads owner handle into the skill lookup when provided", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: null,
      owner: {
        _id: "publishers:1",
        handle: "clawkit",
        displayName: "Clawkit",
      },
      forkOf: null,
      canonical: null,
    });

    await expect(fetchSkillPageData("weather", "clawkit")).resolves.toEqual(
      expect.objectContaining({
        owner: "clawkit",
        initialData: expect.objectContaining({
          lookupOwnerHandle: "clawkit",
        }),
      }),
    );
    expect(queryMock).toHaveBeenCalledWith("skills:getBySlug", {
      slug: "weather",
      ownerHandle: "clawkit",
    });
  });

  it("falls back to slug-only lookup when an older read backend rejects owner handles", async () => {
    queryMock.mockRejectedValueOnce(new Error("Server Error")).mockResolvedValueOnce({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: null,
      owner: {
        _id: "publishers:1",
        handle: "clawkit",
        displayName: "Clawkit",
      },
      forkOf: null,
      canonical: null,
    });

    await expect(fetchSkillPageData("weather", "clawkit")).resolves.toEqual(
      expect.objectContaining({
        owner: "clawkit",
        initialData: expect.objectContaining({
          lookupOwnerHandle: null,
        }),
      }),
    );
    expect(queryMock).toHaveBeenNthCalledWith(1, "skills:getBySlug", {
      slug: "weather",
      ownerHandle: "clawkit",
    });
    expect(queryMock).toHaveBeenNthCalledWith(2, "skills:getBySlug", { slug: "weather" });
  });

  it("does not use slug-only fallback data when it belongs to another owner", async () => {
    queryMock.mockRejectedValueOnce(new Error("Server Error")).mockResolvedValueOnce({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: null,
      owner: {
        _id: "publishers:2",
        handle: "someone-else",
        displayName: "Someone Else",
      },
      forkOf: null,
      canonical: null,
    });

    await expect(fetchSkillPageData("weather", "clawkit")).resolves.toEqual({
      owner: null,
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    });
  });

  it("keeps skill snapshot when readme fetch fails", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: {
        _id: "skillVersions:1",
        version: "1.0.0",
      },
      owner: {
        _id: "users:1",
        handle: "steipete",
        name: "Peter",
      },
      forkOf: null,
      canonical: null,
    });
    actionMock.mockRejectedValue(new Error("boom"));

    await expect(fetchSkillPageData("weather")).resolves.toEqual({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: {
        result: expect.objectContaining({
          skill: expect.objectContaining({ slug: "weather" }),
        }),
        readme: null,
        readmeError: "boom",
      },
    });
  });

  it("returns empty snapshot when the skill is missing", async () => {
    queryMock.mockResolvedValue(null);

    await expect(fetchSkillPageData("missing")).resolves.toEqual({
      owner: null,
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    });
    expect((actionMock as Mock).mock.calls).toHaveLength(0);
  });

  it("falls back to owner name when handle is missing", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: {
        _id: "skillVersions:1",
        version: "1.0.0",
      },
      owner: {
        _id: "users:1",
        handle: null,
        name: "Peter Steinberger",
      },
      forkOf: null,
      canonical: null,
    });
    actionMock.mockResolvedValue({ text: "# Weather" });

    await expect(fetchSkillPageData("weather")).resolves.toEqual(
      expect.objectContaining({
        owner: "Peter Steinberger",
      }),
    );
  });

  it("skips readme fetch when there is no latest version", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: null,
      owner: {
        _id: "users:1",
        handle: "steipete",
        name: "Peter",
      },
      forkOf: null,
      canonical: null,
    });

    await expect(fetchSkillPageData("weather")).resolves.toEqual({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: null,
      initialData: {
        result: expect.objectContaining({
          skill: expect.objectContaining({ slug: "weather" }),
          latestVersion: null,
        }),
        readme: null,
        readmeError: null,
      },
    });
    expect((actionMock as Mock).mock.calls).toHaveLength(0);
  });

  it("uses default readme error for non-Error failures", async () => {
    queryMock.mockResolvedValue({
      skill: {
        _id: "skills:1",
        slug: "weather",
        displayName: "Weather",
        summary: "Get current weather.",
      },
      latestVersion: {
        _id: "skillVersions:1",
        version: "1.0.0",
      },
      owner: {
        _id: "users:1",
        handle: "steipete",
        name: "Peter",
      },
      forkOf: null,
      canonical: null,
    });
    actionMock.mockRejectedValue("boom");

    await expect(fetchSkillPageData("weather")).resolves.toEqual(
      expect.objectContaining({
        initialData: expect.objectContaining({
          readme: null,
          readmeError: "Failed to load SKILL.md",
        }),
      }),
    );
  });

  it("returns empty snapshot when the skill query throws", async () => {
    queryMock.mockRejectedValue(new Error("network down"));

    await expect(fetchSkillPageData("weather")).resolves.toEqual({
      owner: null,
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    });
    expect((actionMock as Mock).mock.calls).toHaveLength(0);
  });
});

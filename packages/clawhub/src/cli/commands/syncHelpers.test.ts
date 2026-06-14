/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const httpMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  downloadZip: vi.fn(),
}));

vi.mock("../scanSkills.js", () => ({
  findSkillFolders: vi.fn(async (root: string) => {
    if (root.endsWith("/with-skill")) {
      return [{ folder: `${root}/demo`, slug: "demo", displayName: "Demo" }];
    }
    return [];
  }),
}));

vi.mock("../../http.js", () => ({
  apiRequest: (registry: unknown, args: unknown, schema: unknown) =>
    httpMocks.apiRequest(registry, args, schema),
  downloadZip: (registry: unknown, args: unknown) => httpMocks.downloadZip(registry, args),
}));

vi.mock("../../skills.js", () => ({
  hashSkillZip: () => ({ fingerprint: "remote-fingerprint", files: [] }),
}));

const { checkRegistrySyncState, scanRootsWithLabels } = await import("./syncHelpers.js");

describe("checkRegistrySyncState", () => {
  it("does not classify fallback registry failures as new skills", async () => {
    httpMocks.apiRequest.mockRejectedValueOnce(new Error("HTTP 500"));

    await expect(
      checkRegistrySyncState(
        "https://clawhub.ai",
        {
          folder: "/tmp/demo",
          slug: "demo",
          displayName: "Demo",
          fingerprint: "local-fingerprint",
          fileCount: 1,
          origin: null,
        },
        { value: false },
      ),
    ).rejects.toThrow("HTTP 500");
  });

  it("still classifies explicit fallback not-found responses as new skills", async () => {
    httpMocks.apiRequest.mockRejectedValueOnce(new Error("HTTP 404"));

    await expect(
      checkRegistrySyncState(
        "https://clawhub.ai",
        {
          folder: "/tmp/demo",
          slug: "demo",
          displayName: "Demo",
          fingerprint: "local-fingerprint",
          fileCount: 1,
          origin: null,
        },
        { value: false },
      ),
    ).resolves.toMatchObject({
      status: "new",
      matchVersion: null,
      latestVersion: null,
    });
  });
});

describe("scanRootsWithLabels", () => {
  it("attaches labels to roots with skills", async () => {
    const roots = ["/tmp/with-skill", "/tmp/empty", "/tmp/with-skill"];
    const labels = { "/tmp/with-skill": "Agent: Work" };

    const result = await scanRootsWithLabels(roots, labels);

    expect(result.rootsWithSkills).toEqual(["/tmp/with-skill"]);
    expect(result.rootLabels).toEqual({ "/tmp/with-skill": "Agent: Work" });
    expect(result.skills.map((skill) => skill.slug)).toEqual(["demo"]);
  });
});

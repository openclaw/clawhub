/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";
import { ApiRoutes } from "../../schema/index.js";
const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdInspect, cmdVerifySkill } = await import("./inspect");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

function loggedOutput() {
  return mockLog.mock.calls.map((call) => String(call[0])).join("\n");
}

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockWrite.mockClear();
  process.exitCode = undefined;
});

describe("cmdInspect", () => {
  it("fetches latest version files when --files is set", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: { latest: "1.2.3" },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: "1.2.3", createdAt: 3, changelog: "init", license: "MIT-0" },
        owner: null,
      })
      .mockResolvedValueOnce({
        skill: { slug: "demo", displayName: "Demo" },
        version: { version: "1.2.3", createdAt: 3, changelog: "init", files: [] },
      });

    await cmdInspect(makeGlobalOpts(), "demo", { files: true });

    const firstArgs = httpMocks.apiRequest.mock.calls[0]?.[1];
    const secondArgs = httpMocks.apiRequest.mock.calls[1]?.[1];
    expect(new URL(String(firstArgs?.url)).pathname).toBe(
      `${ApiRoutes.skills}/${encodeURIComponent("demo")}`,
    );
    expect(new URL(String(secondArgs?.url)).pathname).toBe(
      `${ApiRoutes.skills}/${encodeURIComponent("demo")}/versions/${encodeURIComponent("1.2.3")}`,
    );
  });

  it("passes owner when inspecting an owner-named skill", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: null,
      owner: { handle: "openclaw" },
    });

    await cmdInspect(makeGlobalOpts(), "@openclaw/demo");

    const args = httpMocks.apiRequest.mock.calls[0]?.[1];
    const url = new URL(String(args?.url));
    expect(url.pathname).toBe("/api/v1/skills/demo");
    expect(url.searchParams.get("ownerHandle")).toBe("openclaw");
  });

  it("uses tag param when fetching a file", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: { latest: "2.0.0" },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: "2.0.0", createdAt: 3, changelog: "init", license: "MIT-0" },
        owner: null,
      })
      .mockResolvedValueOnce({
        skill: { slug: "demo", displayName: "Demo" },
        version: { version: "2.0.0", createdAt: 3, changelog: "init", files: [] },
      });
    httpMocks.fetchText.mockResolvedValue("content");

    await cmdInspect(makeGlobalOpts(), "demo", { file: "SKILL.md", tag: "latest" });

    const fetchArgs = httpMocks.fetchText.mock.calls[0]?.[1];
    const url = new URL(String(fetchArgs?.url));
    expect(url.pathname).toBe("/api/v1/skills/demo/file");
    expect(url.searchParams.get("path")).toBe("SKILL.md");
    expect(url.searchParams.get("tag")).toBe("latest");
    expect(url.searchParams.get("version")).toBeNull();
  });

  it("prints security summary when version security metadata exists", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: { latest: "2.0.0" },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: "2.0.0", createdAt: 3, changelog: "init", license: "MIT-0" },
        owner: null,
      })
      .mockResolvedValueOnce({
        skill: { slug: "demo", displayName: "Demo" },
        version: {
          version: "2.0.0",
          createdAt: 3,
          changelog: "init",
          files: [],
          security: {
            status: "suspicious",
            hasWarnings: true,
            checkedAt: 1_700_000_000_000,
            model: "gpt-5.2",
          },
        },
      });

    await cmdInspect(makeGlobalOpts(), "demo", { version: "2.0.0" });

    const output = loggedOutput();
    expect(output).toMatch(/License\s+MIT-0/);
    expect(output).toMatch(/Security\s+SUSPICIOUS/);
    expect(output).toMatch(/Warnings\s+yes/);
    expect(output).toMatch(/Checked\s+2023-11-14 22:13 UTC/);
    expect(output).toMatch(/Model\s+gpt-5.2/);
  });

  it("prints skill moderation status without requiring a version fetch", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: { latest: "2.0.0" },
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: { version: "2.0.0", createdAt: 3, changelog: "init", license: "MIT-0" },
      owner: null,
      moderation: {
        isSuspicious: true,
        isMalwareBlocked: false,
        verdict: "suspicious",
        reasonCodes: ["network-send", "credential-pattern"],
        updatedAt: 1_700_000_000_000,
        engineVersion: "scanner-v2",
        summary: "Found credential-like configuration and outbound network behavior.",
      },
    });

    await cmdInspect(makeGlobalOpts(), "demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    const output = loggedOutput();
    expect(output).toMatch(/Moderate\s+SUSPICIOUS/);
    expect(output).toMatch(/Reasons\s+network-send, credential-pattern/);
    expect(output).toMatch(/Mod Time\s+2023-11-14 22:13 UTC/);
    expect(output).toMatch(/Engine\s+scanner-v2/);
    expect(output).toMatch(
      /Mod Note\s+Found credential-like configuration and outbound network behavior/,
    );
  });

  it("fetches owner moderation diagnostics when authenticated", async () => {
    authTokenMocks.getOptionalAuthToken.mockResolvedValueOnce("tkn");
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: { latest: "2.0.0" },
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: { version: "2.0.0", createdAt: 3, changelog: "init", license: "MIT-0" },
        owner: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        moderation: {
          isSuspicious: true,
          isMalwareBlocked: false,
          verdict: "suspicious",
          reasonCodes: ["suspicious.dynamic_code_execution"],
          updatedAt: 1_700_000_000_000,
          engineVersion: "scanner-v2",
          summary: "Detected dynamic code execution.",
          legacyReason: "quality.low",
          evidence: [],
        },
      });

    await cmdInspect(makeGlobalOpts(), "demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(httpMocks.apiRequest.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      token: "tkn",
    });
    expect(new URL(String(httpMocks.apiRequest.mock.calls[1]?.[1].url)).pathname).toBe(
      `${ApiRoutes.skills}/${encodeURIComponent("demo")}/moderation`,
    );
    const output = loggedOutput();
    expect(output).toMatch(/Moderate\s+SUSPICIOUS/);
    expect(output).toMatch(/Reasons\s+suspicious.dynamic_code_execution/);
    expect(output).toMatch(/Reason\s+quality.low/);
    expect(output).toMatch(/Guidance\s+Visibility Guidance: publish a substantive update/);
  });

  it("prints owner moderation diagnostics when public detail is hidden", async () => {
    authTokenMocks.getOptionalAuthToken.mockResolvedValueOnce("tkn");
    httpMocks.apiRequest
      .mockRejectedValueOnce(new Error("Skill is hidden by quality checks."))
      .mockResolvedValueOnce({
        moderation: {
          isSuspicious: true,
          isMalwareBlocked: false,
          verdict: "suspicious",
          reasonCodes: [],
          updatedAt: null,
          engineVersion: null,
          summary: null,
          legacyReason: "quality.low",
          evidence: [],
        },
      });

    await cmdInspect(makeGlobalOpts(), "demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(mockLog).toHaveBeenCalledWith("demo is not publicly visible.");
    expect(mockLog).toHaveBeenCalledWith("Detail: Skill is hidden by quality checks.");
    const output = loggedOutput();
    expect(output).toMatch(/Reason\s+quality.low/);
    expect(output).toMatch(/Guidance\s+Visibility Guidance: publish a substantive update/);
  });

  it("includes moderation metadata in inspect JSON output", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: null,
      owner: null,
      moderation: {
        isSuspicious: false,
        isMalwareBlocked: false,
        verdict: "clean",
        reasonCodes: [],
        updatedAt: null,
        engineVersion: null,
        summary: null,
      },
    });

    await cmdInspect(makeGlobalOpts(), "demo", { json: true });

    const output = JSON.parse(String(mockLog.mock.calls[0]?.[0]));
    expect(output.moderation).toEqual({
      isSuspicious: false,
      isMalwareBlocked: false,
      verdict: "clean",
      reasonCodes: [],
      updatedAt: null,
      engineVersion: null,
      summary: null,
    });
  });

  it("rejects when both version and tag are provided", async () => {
    await expect(
      cmdInspect(makeGlobalOpts(), "demo", { version: "1.0.0", tag: "latest" }),
    ).rejects.toThrow("Use either --version or --tag");
  });
});

describe("cmdVerifySkill", () => {
  it("fetches and prints JSON verification by default", async () => {
    const payload = {
      schema: "clawhub.skill.verify.v1",
      ok: true,
      decision: "pass",
      reasons: [],
      slug: "demo",
      displayName: "Demo",
      pageUrl: "https://clawhub.ai/acme/skills/demo",
      publisherHandle: "acme",
      publisherDisplayName: "Acme",
      publisherProfileUrl: "https://clawhub.ai/acme",
      version: "1.2.3",
      resolvedFrom: "tag",
      tag: "stable",
      createdAt: 12,
      card: {
        available: true,
        path: "skill-card.md",
        url: "https://clawhub.ai/api/v1/skills/demo/card?version=1.2.3",
      },
      artifact: {
        sourceFingerprint: "source-fingerprint",
        bundleFingerprints: ["bundle-fingerprint"],
        files: [{ path: "SKILL.md", size: 42, sha256: "sha256:file" }],
      },
      provenance: {
        source: "server-resolved-github-import",
        repo: "acme/demo",
        commit: "0123456789abcdef",
        path: "skills/demo",
      },
      security: {
        status: "clean",
        passed: true,
        rawStatus: "clean",
        verdict: "clean",
        summary: "ClawScan clean.",
        signals: {
          staticScan: { status: "clean", rawStatus: "clean", reasonCodes: [] },
          virusTotal: { status: "clean", rawStatus: "clean", source: "engines" },
          skillSpector: { status: "clean", rawStatus: "clean", issueCount: 0 },
          dependencyRegistry: null,
        },
      },
      signature: { status: "unsigned" },
    };
    httpMocks.apiRequest.mockResolvedValueOnce(payload);

    await cmdVerifySkill(makeGlobalOpts(), "demo", { tag: "stable" });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1];
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/skills/demo/verify");
    expect(url.searchParams.get("tag")).toBe("stable");
    expect(JSON.parse(String(mockLog.mock.calls[0]?.[0]))).toEqual(payload);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints JSON by default and sets a non-zero exit code when verification fails", async () => {
    const payload = {
      schema: "clawhub.skill.verify.v1",
      ok: false,
      decision: "fail",
      reasons: ["card.missing", "security.status_not_clean"],
      slug: "demo",
      displayName: "Demo",
      pageUrl: "https://clawhub.ai/acme/skills/demo",
      publisherHandle: "acme",
      publisherDisplayName: "Acme",
      publisherProfileUrl: "https://clawhub.ai/acme",
      version: "1.2.3",
      resolvedFrom: "latest",
      tag: null,
      createdAt: 12,
      card: { available: false },
      artifact: { sourceFingerprint: "source-fingerprint", bundleFingerprints: [], files: [] },
      provenance: { source: "unavailable" },
      security: { status: "suspicious", passed: false },
      signature: { status: "unsigned" },
    };
    httpMocks.apiRequest.mockResolvedValueOnce(payload);

    await cmdVerifySkill(makeGlobalOpts(), "demo");

    expect(JSON.parse(String(mockLog.mock.calls[0]?.[0]))).toEqual(payload);
    expect(process.exitCode).toBe(1);
  });

  it("prints the generated skill card when --card is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      schema: "clawhub.skill.verify.v1",
      ok: true,
      decision: "pass",
      reasons: [],
      slug: "demo",
      displayName: "Demo",
      pageUrl: "https://clawhub.ai/acme/skills/demo",
      publisherHandle: "acme",
      publisherDisplayName: "Acme",
      publisherProfileUrl: "https://clawhub.ai/acme",
      version: "1.2.3",
      resolvedFrom: "latest",
      tag: null,
      createdAt: 12,
      card: {
        available: true,
        path: "skill-card.md",
        url: "https://clawhub.ai/api/v1/skills/demo/card?version=1.2.3",
      },
      artifact: { sourceFingerprint: "source-fingerprint", bundleFingerprints: [], files: [] },
      provenance: { source: "unavailable" },
      security: { status: "clean", passed: true },
      signature: { status: "unsigned" },
    });
    httpMocks.fetchText.mockResolvedValueOnce("# Skill Card\n");

    await cmdVerifySkill(makeGlobalOpts(), "demo", { card: true });

    const fetchArgs = httpMocks.fetchText.mock.calls[0]?.[1];
    expect(fetchArgs?.url).toBe("https://clawhub.ai/api/v1/skills/demo/card?version=1.2.3");
    expect(mockWrite).toHaveBeenCalledWith("# Skill Card\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects when both version and tag are provided", async () => {
    await expect(
      cmdVerifySkill(makeGlobalOpts(), "demo", { version: "1.0.0", tag: "latest" }),
    ).rejects.toThrow("Use either --version or --tag");
  });
});

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

const { cmdInspect } = await import("./inspect");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockWrite.mockClear();
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
    expect(firstArgs?.path).toBe(`${ApiRoutes.skills}/${encodeURIComponent("demo")}`);
    expect(secondArgs?.path).toBe(
      `${ApiRoutes.skills}/${encodeURIComponent("demo")}/versions/${encodeURIComponent("1.2.3")}`,
    );
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

    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("License: MIT-0"));
    expect(mockLog).toHaveBeenCalledWith("Security: SUSPICIOUS");
    expect(mockLog).toHaveBeenCalledWith("Warnings: yes");
    expect(mockLog).toHaveBeenCalledWith("Checked: 2023-11-14T22:13:20.000Z");
    expect(mockLog).toHaveBeenCalledWith("Model: gpt-5.2");
  });

  it("rejects when both version and tag are provided", async () => {
    await expect(
      cmdInspect(makeGlobalOpts(), "demo", { version: "1.0.0", tag: "latest" }),
    ).rejects.toThrow("Use either --version or --tag");
  });
});

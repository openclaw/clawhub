/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../../clawhub/src/cli/authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registryMocks.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => httpMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/ui.js", () => uiMocks.moduleFactory());

const { cmdSetPackageFeatured, cmdSetSkillFeatured } = await import("./featured");

afterEach(() => {
  vi.clearAllMocks();
});

describe("featured catalog commands", () => {
  it("features a plugin through the moderator API", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      featured: true,
      packageId: "packages:1",
      name: "@openclaw/demo-plugin",
    });

    await cmdSetPackageFeatured(makeGlobalOpts(), "@openclaw/demo-plugin", true);

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fdemo-plugin/featured",
        token: "tkn",
        body: { featured: true },
      }),
      undefined,
    );
  });

  it("unfeatures an owner-qualified skill through the moderator API", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      featured: false,
      skillId: "skills:1",
      slug: "weather",
      ownerHandle: "openclaw",
    });

    await cmdSetSkillFeatured(makeGlobalOpts(), "@openclaw/weather", false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/weather/featured",
        token: "tkn",
        body: { featured: false, ownerHandle: "openclaw" },
      }),
      undefined,
    );
  });

  it("rejects malformed skill refs before making a request", async () => {
    await expect(cmdSetSkillFeatured(makeGlobalOpts(), "a/b/c", true)).rejects.toThrow(
      /invalid skill ref/i,
    );
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

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

const { cmdCreateOrg } = await import("./orgs");

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdCreateOrg", () => {
  it("creates an org publisher and adds the legacy owner as owner by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      migrated: false,
      trusted: false,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "Opik", {
      displayName: "Opik",
      member: "vincentkoc",
    });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher",
        token: "tkn",
        body: {
          handle: "opik",
          displayName: "Opik",
          memberHandle: "vincentkoc",
          memberRole: "owner",
        },
      }),
      expect.anything(),
    );
  });

  it("only sends trusted when explicitly requested", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      migrated: false,
      trusted: true,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "opik", { member: "vincentkoc", trusted: true });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: {
          handle: "opik",
          memberHandle: "vincentkoc",
          memberRole: "owner",
          trusted: true,
        },
      }),
      expect.anything(),
    );
  });

  it("requires a valid org member role", async () => {
    await expect(
      cmdCreateOrg(makeGlobalOpts(), "opik", {
        member: "vincentkoc",
        role: "moderator",
      }),
    ).rejects.toThrow(/--role must be owner, admin, or publisher/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("requires an explicit member so the moderator is not added as owner", async () => {
    await expect(cmdCreateOrg(makeGlobalOpts(), "opik", {})).rejects.toThrow(/--member required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

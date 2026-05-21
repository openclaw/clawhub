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
  it("creates an org publisher and adds a legacy owner member", async () => {
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
        role: "admin",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "Opik", {
      displayName: "Opik",
      member: "vincentkoc",
      role: "admin",
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
          memberRole: "admin",
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
    });

    await cmdCreateOrg(makeGlobalOpts(), "opik", { trusted: true });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: {
          handle: "opik",
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
});

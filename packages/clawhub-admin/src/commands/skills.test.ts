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

const { cmdHardDeleteSkill } = await import("./skills");

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdHardDeleteSkill", () => {
  it("dry-runs an owner-qualified skill by default", async () => {
    const generated_token_reference = "hard-delete-skill:@openclaw/demo:skills:demo";
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      skillId: "skills:demo",
      slug: "demo",
      ownerHandle: "openclaw",
      displayName: "Demo",
      dryRun: true,
      scheduled: false,
      confirmationToken: generated_token_reference,
    });

    const result = await cmdHardDeleteSkill(
      makeGlobalOpts(),
      "@OpenClaw/Demo",
      { reason: "Owner-requested cleanup", json: true },
      false,
    );

    expect(result).toMatchObject({
      dryRun: true,
      scheduled: false,
      ownerHandle: "openclaw",
      slug: "demo",
    });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/hard-delete",
        token: "tkn",
        body: {
          ownerHandle: "openclaw",
          reason: "Owner-requested cleanup",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("requires an owner-qualified skill ref", async () => {
    await expect(
      cmdHardDeleteSkill(makeGlobalOpts(), "demo", { reason: "Cleanup" }, false),
    ).rejects.toThrow(/owner-qualified/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("requires a confirmation token when applying", async () => {
    await expect(
      cmdHardDeleteSkill(
        makeGlobalOpts(),
        "@openclaw/demo",
        { reason: "Cleanup", apply: true, yes: true },
        false,
      ),
    ).rejects.toThrow(/--confirm required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("applies with the dry-run confirmation token and disables retries", async () => {
    const generated_token_reference = "hard-delete-skill:@openclaw/demo:skills:demo";
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      skillId: "skills:demo",
      slug: "demo",
      ownerHandle: "openclaw",
      displayName: "Demo",
      dryRun: false,
      scheduled: true,
      confirmationToken: generated_token_reference,
    });

    await cmdHardDeleteSkill(
      makeGlobalOpts(),
      "@openclaw/demo",
      {
        reason: "Owner-requested cleanup",
        apply: true,
        confirm: generated_token_reference,
        yes: true,
      },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/hard-delete",
        retryCount: 0,
        body: {
          ownerHandle: "openclaw",
          reason: "Owner-requested cleanup",
          dryRun: false,
          confirmationToken: generated_token_reference,
        },
      }),
      expect.anything(),
    );
  });
});

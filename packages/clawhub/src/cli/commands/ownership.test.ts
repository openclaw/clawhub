/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdMergeSkill, cmdRenameSkill } = await import("./ownership");

afterEach(() => {
  vi.clearAllMocks();
});

describe("ownership commands", () => {
  it("rename requires --yes when input is disabled", async () => {
    await expect(cmdRenameSkill(makeGlobalOpts(), "demo", "demo-new", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("rename calls rename endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      slug: "demo-new",
      previousSlug: "demo",
    });

    await cmdRenameSkill(makeGlobalOpts(), "Demo", "Demo-New", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/rename",
      }),
      expect.anything(),
    );
    const requestArgs = httpMocks.apiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"newSlug":"demo-new"');
  });

  it("merge calls merge endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      sourceSlug: "demo-old",
      targetSlug: "demo",
    });

    await cmdMergeSkill(makeGlobalOpts(), "Demo-Old", "Demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo-old/merge",
      }),
      expect.anything(),
    );
    const requestArgs = httpMocks.apiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"targetSlug":"demo"');
  });
});

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

const { cmdUnstarSkill } = await import("./unstar");

afterEach(() => {
  vi.clearAllMocks();
});

describe("unstar command", () => {
  it("supports owner-qualified skill refs", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      unstarred: true,
      alreadyUnstarred: false,
    });

    await cmdUnstarSkill(makeGlobalOpts(), "@OpenClaw/Demo", { yes: true }, false);

    const requestArgs = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string };
    const url = new URL(String(requestArgs.url));
    expect(url.pathname).toBe("/api/v1/stars/demo");
    expect(url.searchParams.get("ownerHandle")).toBe("openclaw");
  });
});

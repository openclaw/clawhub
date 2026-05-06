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

const { cmdDeleteSkill, cmdHideSkill, cmdUndeleteSkill, cmdUnhideSkill } = await import("./delete");

afterEach(() => {
  vi.clearAllMocks();
});

describe("delete/undelete", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdDeleteSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    await expect(cmdUndeleteSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    await expect(cmdHideSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    await expect(cmdUnhideSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
  });

  it("calls delete endpoint with --yes", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE", path: "/api/v1/skills/demo" }),
      expect.anything(),
    );
  });

  it("passes a moderation reason on delete", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true, reason: "legal hold" }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/skills/demo",
        body: { reason: "legal hold" },
      }),
      expect.anything(),
    );
  });

  it("supports --note as a reason alias", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdHideSkill(makeGlobalOpts(), "demo", { yes: true, note: "legal notice" }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/skills/demo",
        body: { reason: "legal notice" },
      }),
      expect.anything(),
    );
  });

  it("rejects conflicting reason aliases", async () => {
    await expect(
      cmdHideSkill(
        makeGlobalOpts(),
        "demo",
        { yes: true, reason: "legal hold", note: "different" },
        false,
      ),
    ).rejects.toThrow(/only one/i);
  });

  it("calls undelete endpoint with --yes", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdUndeleteSkill(makeGlobalOpts(), "demo", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/undelete" }),
      expect.anything(),
    );
  });

  it("passes a moderation reason on undelete", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdUndeleteSkill(makeGlobalOpts(), "demo", { yes: true, reason: "reviewed" }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/undelete",
        body: { reason: "reviewed" },
      }),
      expect.anything(),
    );
  });

  it("supports hide/unhide aliases", async () => {
    httpMocks.apiRequest.mockResolvedValue({ ok: true });
    await cmdHideSkill(makeGlobalOpts(), "demo", { yes: true }, false);
    await cmdUnhideSkill(makeGlobalOpts(), "demo", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE", path: "/api/v1/skills/demo" }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/undelete" }),
      expect.anything(),
    );
  });
});

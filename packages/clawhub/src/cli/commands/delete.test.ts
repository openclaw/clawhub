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
const uiMocks = createUiModuleMocks({ interactive: true });

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

  it("deletes one skill version through the existing endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true, version: " 1.2.3 " }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/skills/demo/versions/1.2.3",
        body: { version: "1.2.3" },
        retryCount: 0,
      }),
      expect.anything(),
    );
  });

  it("keeps whole-skill delete requests unchanged without --version", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/skills/demo",
        body: undefined,
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).not.toHaveProperty("retryCount");
  });

  it("confirms that skill version deletion is a reversible withdrawal", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeleteSkill(makeGlobalOpts(), "demo", { version: "1.2.3" }, true);

    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(expect.stringContaining("version 1.2.3"));
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("exact retained artifact can be restored"),
    );
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("version number remains reserved"),
    );
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("publish a replacement first"),
    );
  });

  it("requires --yes for non-interactive skill version deletion", async () => {
    await expect(
      cmdDeleteSkill(makeGlobalOpts(), "demo", { version: "1.2.3" }, false),
    ).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty skill version", async () => {
    await expect(
      cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true, version: "   " }, false),
    ).rejects.toThrow(/version.*empty/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects whole-skill moderation reasons for version deletion", async () => {
    await expect(
      cmdDeleteSkill(
        makeGlobalOpts(),
        "demo",
        { yes: true, version: "1.2.3", reason: "cleanup" },
        false,
      ),
    ).rejects.toThrow(/whole-skill deletion/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("prints the slug reservation expiry returned by delete", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      slugReservedUntil: 1_700_086_400_000,
    });
    await cmdDeleteSkill(makeGlobalOpts(), "demo", { yes: true }, false);
    expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
      "OK. Deleted demo. Slug reserved until 2023-11-15T22:13:20.000Z",
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

  it("delete accepts owner-qualified refs", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdDeleteSkill(makeGlobalOpts(), "@Alice/Demo", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/skills/demo",
        body: { ownerHandle: "alice" },
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

  it("restores an owner-withdrawn skill version without retrying", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdUndeleteSkill(
      makeGlobalOpts(),
      "@Alice/Demo",
      { yes: true, version: " 1.2.3 " },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/versions/1.2.3/restore",
        body: { ownerHandle: "alice", version: "1.2.3" },
        retryCount: 0,
      }),
      expect.anything(),
    );
  });

  it("rejects whole-skill moderation reasons on version restore", async () => {
    await expect(
      cmdUndeleteSkill(
        makeGlobalOpts(),
        "demo",
        { yes: true, version: "1.2.3", reason: "reviewed" },
        false,
      ),
    ).rejects.toThrow(/whole-skill restoration/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
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

  it("undelete accepts owner-qualified refs", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });
    await cmdUndeleteSkill(makeGlobalOpts(), "@Alice/Demo", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/undelete",
        body: { ownerHandle: "alice" },
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

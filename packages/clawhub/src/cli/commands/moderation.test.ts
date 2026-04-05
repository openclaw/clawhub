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

const { cmdBanUser, cmdSetRole } = await import("./moderation");

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdBanUser", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdBanUser(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
  });

  it("posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 1,
    });
    await cmdBanUser(makeGlobalOpts(), "hightower6eu", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { handle: "hightower6eu" },
      }),
      expect.anything(),
    );
  });

  it("includes reason when provided", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 0,
    });
    await cmdBanUser(
      makeGlobalOpts(),
      "hightower6eu",
      { yes: true, reason: "malware distribution" },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { handle: "hightower6eu", reason: "malware distribution" },
      }),
      expect.anything(),
    );
  });

  it("posts user id payload when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 0,
    });
    await cmdBanUser(makeGlobalOpts(), "user_123", { yes: true, id: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { userId: "user_123" },
      }),
      expect.anything(),
    );
  });

  it("resolves user via fuzzy search", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            userId: "users_123",
            handle: "moonshine-100rze",
            displayName: null,
            name: null,
            role: "user",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 });
    await cmdBanUser(makeGlobalOpts(), "moonshine-100rze", { yes: true, fuzzy: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("/api/v1/users?"),
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { userId: "users_123" },
      }),
      expect.anything(),
    );
  });

  it("fails fuzzy search with multiple matches when not interactive", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          userId: "users_1",
          handle: "moonshine-100rze",
          displayName: null,
          name: null,
          role: null,
        },
        {
          userId: "users_2",
          handle: "moonshine-100rze2",
          displayName: null,
          name: null,
          role: null,
        },
      ],
      total: 2,
    });
    await expect(
      cmdBanUser(makeGlobalOpts(), "moonshine", { yes: true, fuzzy: true }, false),
    ).rejects.toThrow(/multiple users matched/i);
  });
});

describe("cmdSetRole", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdSetRole(makeGlobalOpts(), "demo", "moderator", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("rejects invalid roles", async () => {
    await expect(
      cmdSetRole(makeGlobalOpts(), "demo", "owner", { yes: true }, false),
    ).rejects.toThrow(/role/i);
  });

  it("posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true, role: "moderator" });
    await cmdSetRole(makeGlobalOpts(), "hightower6eu", "moderator", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/role",
        body: { handle: "hightower6eu", role: "moderator" },
      }),
      expect.anything(),
    );
  });

  it("posts user id payload when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true, role: "admin" });
    await cmdSetRole(makeGlobalOpts(), "user_123", "admin", { yes: true, id: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/role",
        body: { userId: "user_123", role: "admin" },
      }),
      expect.anything(),
    );
  });
});

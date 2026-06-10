/* @vitest-environment node */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const { cmdSendStaffEmail } = await import("./email");

afterEach(() => {
  vi.clearAllMocks();
});

async function withBody(content: string) {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-mod-email-"));
  const path = join(dir, "body.txt");
  await writeFile(path, content, "utf8");
  return {
    path,
    async cleanup() {
      await rm(dir, { force: true, recursive: true });
    },
  };
}

describe("cmdSendStaffEmail", () => {
  it("previews locally by default without auth or API calls", async () => {
    const body = await withBody("Hello from ClawHub.");
    try {
      const result = await cmdSendStaffEmail(makeGlobalOpts(), {
        to: "USER@example.com",
        subject: "Account update",
        bodyFile: body.path,
        json: true,
      });

      expect(result).toMatchObject({
        ok: true,
        dryRun: true,
        recipient: { email: "user@example.com" },
        subject: "Account update",
        body: "Hello from ClawHub.",
      });
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequest).not.toHaveBeenCalled();
    } finally {
      await body.cleanup();
    }
  });

  it("refuses to send unless both explicit-request and signoff flags are present", async () => {
    await expect(
      cmdSendStaffEmail(makeGlobalOpts(), {
        user: "Hansen302",
        subject: "Account update",
        body: "Hello from ClawHub.",
        send: true,
        confirmUserRequest: true,
      }),
    ).rejects.toThrow(/Refusing to send/i);
    expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("sends through the admin endpoint after explicit user request and signoff are confirmed", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      sent: true,
      recipient: { email: "user@example.com", userId: "users:1", handle: "hansen302" },
      subject: "Account update",
      providerId: "email:123",
    });

    const result = await cmdSendStaffEmail(makeGlobalOpts(), {
      user: "@Hansen302",
      subject: "Account update",
      body: "Hello from ClawHub.",
      send: true,
      confirmUserRequest: true,
      confirmUserSignoff: true,
      json: true,
    });

    expect(result).toMatchObject({ ok: true, sent: true, providerId: "email:123" });
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/email",
        token: "tkn",
        body: {
          userHandle: "hansen302",
          subject: "Account update",
          body: "Hello from ClawHub.",
          confirmUserRequest: true,
          confirmUserSignoff: true,
        },
      }),
      expect.anything(),
    );
  });
});

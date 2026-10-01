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
  const dir = await mkdtemp(join(tmpdir(), "clawhub-admin-email-"));
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
        title: "A quick ClawHub note",
        actionLabel: "Open ClawHub",
        actionUrl: "https://clawhub.ai/settings",
        json: true,
      });

      expect(result).toMatchObject({
        ok: true,
        dryRun: true,
        template: "generic-one-off",
        recipient: { email: "user@example.com" },
        subject: "Account update",
        title: "A quick ClawHub note",
        body: "Hello from ClawHub.",
        primaryAction: {
          label: "Open ClawHub",
          url: "https://clawhub.ai/settings",
        },
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

  it("validates one-off action label and URL together", async () => {
    await expect(
      cmdSendStaffEmail(makeGlobalOpts(), {
        to: "user@example.com",
        subject: "Account update",
        body: "Hello from ClawHub.",
        actionLabel: "Open ClawHub",
      }),
    ).rejects.toThrow(
      /Pass --action-label\/--button-text and --action-url\/--button-link together/i,
    );
    await expect(
      cmdSendStaffEmail(makeGlobalOpts(), {
        to: "user@example.com",
        subject: "Account update",
        body: "Hello from ClawHub.",
        actionLabel: "Open ClawHub",
        actionUrl: "ftp://example.com",
      }),
    ).rejects.toThrow(/--action-url must be an http\(s\) URL/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("sends through the admin endpoint after explicit user request and signoff are confirmed", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      sent: true,
      recipient: { email: "user@example.com", userId: "users:1", handle: "hansen302" },
      subject: "Account update",
      template: "generic-one-off",
      providerId: "email:123",
    });

    const result = await cmdSendStaffEmail(makeGlobalOpts(), {
      user: "@Hansen302",
      subject: "Account update",
      body: "Hello from ClawHub.",
      title: "A quick ClawHub note",
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
          template: "generic-one-off",
          subject: "Account update",
          title: "A quick ClawHub note",
          body: "Hello from ClawHub.",
          confirmUserRequest: true,
          confirmUserSignoff: true,
        },
      }),
      expect.anything(),
    );
  });

  it("maps username and button aliases into the generic one-off template payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      sent: true,
      recipient: { email: "user@example.com", handle: "octocat" },
      subject: "Account update",
      template: "generic-one-off",
      providerId: "email:123",
    });

    const result = await cmdSendStaffEmail(makeGlobalOpts(), {
      to: "user@example.com",
      username: "octocat",
      subject: "Account update",
      body: "Hello from ClawHub.",
      title: "A quick ClawHub note",
      buttonText: "Open appeal",
      buttonLink: "https://appeals.openclaw.ai/case-123",
      send: true,
      confirmUserRequest: true,
      confirmUserSignoff: true,
      json: true,
    });

    expect(result).toMatchObject({ ok: true, sent: true, providerId: "email:123" });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: {
          toEmail: "user@example.com",
          recipientHandle: "octocat",
          template: "generic-one-off",
          subject: "Account update",
          title: "A quick ClawHub note",
          body: "Hello from ClawHub.",
          primaryActionLabel: "Open appeal",
          primaryActionUrl: "https://appeals.openclaw.ai/case-123",
          confirmUserRequest: true,
          confirmUserSignoff: true,
        },
      }),
      expect.anything(),
    );
  });
});

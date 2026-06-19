/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendConstructorMock, resendSendMock } = vi.hoisted(() => ({
  resendConstructorMock: vi.fn(function ResendMock() {
    return { emails: { send: resendSendMock } };
  }),
  resendSendMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: resendConstructorMock,
}));

const { sendBanNotificationInternal } = await import("./emailsNode");

type SendBanNotificationHandler = {
  _handler: (
    ctx: unknown,
    args: {
      userId: string;
      bannedAt: number;
      to: string;
      handle?: string;
      source: "manual" | "autoban";
      reason?: string;
    },
  ) => Promise<unknown>;
};

describe("transactional account emails", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "resend_test");
    resendConstructorMock.mockClear();
    resendSendMock.mockReset();
    resendSendMock.mockResolvedValue({ data: { id: "email_123" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends ban notifications without a Reply-To header", async () => {
    const result = await (
      sendBanNotificationInternal as unknown as SendBanNotificationHandler
    )._handler(
      {},
      {
        userId: "users:target",
        bannedAt: 1_700_000_000_000,
        to: "target@example.com",
        handle: "target",
        source: "manual",
        reason: "security review",
      },
    );

    expect(result).toEqual({ ok: true, id: "email_123" });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = resendSendMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      from: "ClawHub Security <noreply@notifications.openclaw.ai>",
      to: "target@example.com",
      subject: "Your ClawHub account has been suspended",
    });
    expect(payload).not.toHaveProperty("replyTo");
    expect(options).toEqual({ idempotencyKey: "ban:users:target:1700000000000" });
  });
});

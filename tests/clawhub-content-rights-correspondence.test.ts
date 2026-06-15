import { describe, expect, it, vi } from "vitest";
import {
  buildAdminEmailArgs,
  runCorrespondence,
} from "../.agents/skills/clawhub-content-rights-correspondence/scripts/send-correspondence.js";

describe("ClawHub content rights correspondence skill", () => {
  it("builds a dry-run admin email command by default", () => {
    expect(
      buildAdminEmailArgs({
        to: "legal@example.com",
        subject: "Re: CHR-000007",
        bodyFile: "/tmp/body.txt",
        send: false,
        confirmUserSignoff: false,
      }),
    ).toEqual([
      "run",
      "admin",
      "--",
      "email",
      "send",
      "--to",
      "legal@example.com",
      "--subject",
      "Re: CHR-000007",
      "--body-file",
      "/tmp/body.txt",
      "--json",
    ]);
  });

  it("refuses to send without explicit user signoff", async () => {
    await expect(
      runCorrespondence(
        {
          caseId: "CHR-000007",
          subject: "Re: CHR-000007",
          bodyFile: "/tmp/body.txt",
          attachments: [],
          send: true,
          confirmUserSignoff: false,
        },
        {
          exec: vi.fn(),
        },
      ),
    ).rejects.toThrow("Sending requires --confirm-user-signoff.");
  });

  it("sends to the existing case email and records exact correspondence through Hermit", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          case: { caseId: "CHR-000007", email: "legal@example.com" },
          files: [],
          events: [],
        }),
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ok: true, providerId: "email-123" }),
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ok: true, caseId: "CHR-000007", storedFiles: 2 }),
        stderr: "",
        exitCode: 0,
      });

    await runCorrespondence(
      {
        caseId: "CHR-000007",
        subject: "Re: CHR-000007",
        bodyFile: "/tmp/body.txt",
        attachments: ["/tmp/response.pdf"],
        send: true,
        confirmUserSignoff: true,
      },
      {
        exec: execMock,
      },
    );

    expect(execMock).toHaveBeenNthCalledWith(1, [
      "run",
      "admin",
      "--",
      "content-rights",
      "get",
      "CHR-000007",
      "--json",
    ]);
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["--to", "legal@example.com", "--send", "--confirm-user-signoff"]),
    );
    expect(execMock).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        "content-rights",
        "record-correspondence",
        "CHR-000007",
        "--to",
        "legal@example.com",
        "--body-file",
        "/tmp/body.txt",
        "--provider-message-id",
        "email-123",
        "--attachment",
        "/tmp/response.pdf",
      ]),
    );
  });
});

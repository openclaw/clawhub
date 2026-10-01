/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { proxyHermitContentRightsRequest } from "./contentRightsV1";

describe("ClawHub content rights Hermit proxy", () => {
  it("reads a case using the existing shared ClawHub-Hermit token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ case: { caseId: "CHR-000007" }, files: [], events: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await proxyHermitContentRightsRequest(
      new Request("https://clawhub.ai/api/v1/content-rights/CHR-000007"),
      "users:admin",
      {
        baseUrl: "https://forms.openclaw.ai",
        serviceToken: "shared-token",
        fetch: fetchMock,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://forms.openclaw.ai/api/clawhub-content-rights/cases/CHR-000007",
      {
        method: "GET",
        headers: { Authorization: "Bearer shared-token" },
      },
    );
  });

  it("forwards exact correspondence and evidence with the authenticated admin actor", async () => {
    const body = new FormData();
    body.set("direction", "outbound");
    body.set("to", "legal@example.com");
    body.set("from", "ClawHub <noreply@notifications.openclaw.ai>");
    body.set("subject", "Re: CHR-000007");
    body.set("text", "Exact email body");
    body.set("actor", "untrusted-caller");
    body.append("attachments", new File(["pdf"], "notice.pdf", { type: "application/pdf" }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, caseId: "CHR-000007", storedFiles: 2 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await proxyHermitContentRightsRequest(
      new Request("https://clawhub.ai/api/v1/content-rights/CHR-000007/correspondence", {
        method: "POST",
        body,
      }),
      "users:admin",
      {
        baseUrl: "https://forms.openclaw.ai",
        serviceToken: "shared-token",
        fetch: fetchMock,
      },
    );

    expect(response.status).toBe(201);
    const forwarded = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(forwarded.method).toBe("POST");
    expect(forwarded.body).toBeInstanceOf(FormData);
    const forwardedBody = forwarded.body as FormData;
    expect(forwardedBody.get("actor")).toBe("users:admin");
    expect(forwardedBody.get("text")).toBe("Exact email body");
    expect((forwardedBody.get("attachments") as File).name).toBe("notice.pdf");
  });

  it("refuses to proxy when the shared service token is unavailable", async () => {
    const response = await proxyHermitContentRightsRequest(
      new Request("https://clawhub.ai/api/v1/content-rights/CHR-000007"),
      "users:admin",
      {
        baseUrl: "https://forms.openclaw.ai",
        serviceToken: "",
        fetch: vi.fn(),
      },
    );

    expect(response.status).toBe(503);
  });
});

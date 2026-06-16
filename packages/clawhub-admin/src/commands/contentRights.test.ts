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

const { cmdGetContentRightsCase, cmdRecordContentRightsCorrespondence } =
  await import("./contentRights");

afterEach(() => {
  vi.clearAllMocks();
});

describe("content rights admin commands", () => {
  it("gets an existing case through authenticated ClawHub", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      case: { caseId: "CHR-000007", email: "legal@example.com" },
      files: [],
      events: [],
    });

    await cmdGetContentRightsCase(makeGlobalOpts(), "CHR-000007", { json: true });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/content-rights/CHR-000007",
        token: "tkn",
        retryCount: 0,
      },
      undefined,
    );
  });

  it("records exact correspondence and attachments through authenticated ClawHub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawhub-content-rights-"));
    const bodyFile = join(dir, "body.txt");
    const attachment = join(dir, "notice.pdf");
    await writeFile(bodyFile, "Exact email body");
    await writeFile(attachment, "pdf");
    httpMocks.apiRequestForm.mockResolvedValueOnce({
      ok: true,
      caseId: "CHR-000007",
      storedFiles: 2,
    });

    try {
      await cmdRecordContentRightsCorrespondence(makeGlobalOpts(), "CHR-000007", {
        direction: "outbound",
        to: "legal@example.com",
        from: "ClawHub <noreply@notifications.openclaw.ai>",
        subject: "Re: CHR-000007",
        bodyFile,
        providerMessageId: "email-123",
        attachment: [attachment],
        json: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(httpMocks.apiRequestForm).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/content-rights/CHR-000007/correspondence",
        token: "tkn",
        retryCount: 0,
        form: expect.any(FormData),
      }),
      undefined,
    );
    const call = httpMocks.apiRequestForm.mock.calls[0]?.[1] as { form: FormData };
    expect(call.form.get("text")).toBe("Exact email body");
    expect((call.form.get("attachments") as File).name).toBe("notice.pdf");
  });
});

/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();

vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());

const { cmdCreatePublisher } = await import("./publishers");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

function makeOpts(workdir = "/work") {
  return makeGlobalOpts(workdir);
}

describe("publisher CLI commands", () => {
  it("creates an org publisher through the v1 publishers API", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      trusted: false,
    });

    await cmdCreatePublisher(makeOpts(), "Opik", { displayName: "Opik" });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/publishers",
        token: "tkn",
        body: { handle: "opik", displayName: "Opik" },
      }),
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("OK. Created publisher @opik.");
  });

  it("prints JSON for created org publishers", async () => {
    const response = {
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      trusted: false,
    };
    httpMocks.apiRequest.mockResolvedValueOnce(response);

    await cmdCreatePublisher(makeOpts(), "opik", { json: true });

    expect(mockWrite).toHaveBeenCalledWith(`${JSON.stringify(response, null, 2)}\n`);
  });
});

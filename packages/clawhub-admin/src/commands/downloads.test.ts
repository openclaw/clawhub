import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";
const auth = createAuthTokenModuleMocks();
const registry = createRegistryModuleMocks();
const http = createHttpModuleMocks();
vi.mock("../../../clawhub/src/cli/authToken.js", () => auth.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registry.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => http.moduleFactory());
const { cmdDownloads } = await import("./downloads");
const pending = {
  scope: "templates",
  status: "pending",
  generatedAt: null,
  windowStartAt: null,
  windowEndAt: null,
  downloadsLast24h: null,
  downloadsAllTime: null,
  countingPaused: false,
  refreshInProgress: true,
  refreshStartedAt: 1000,
  refreshExpiresAt: 1801000,
  staleAfterAt: null,
  lastError: null,
  scan: null,
  counterLagNote: "Counters lag processing.",
  eligibilityNote: "Public undeleted Templates.",
  consistencyNote: "Not an atomic snapshot.",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("new downloads command", () => {
  it("requires a token and emits the unchanged API response in JSON mode", async () => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    http.apiRequest.mockResolvedValueOnce(pending);
    await cmdDownloads(makeGlobalOpts(), { json: true });
    expect(auth.requireAuthToken).toHaveBeenCalledOnce();
    expect(http.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/admin/download-analytics",
        token: "tkn",
      }),
      expect.anything(),
    );
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(pending);
  });
  it("refreshes by POST and does not present pending counts as zero", async () => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    http.apiRequest.mockResolvedValueOnce(pending);
    await cmdDownloads(makeGlobalOpts(), { refresh: true });
    expect(http.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({ method: "POST" }),
      expect.anything(),
    );
    const text = output.mock.calls.map(([chunk]) => chunk).join("");
    expect(text).toContain("pending");
    expect(text).toContain("not available");
    expect(text).not.toContain("Last 24 hours: 0");
  });
  it("labels real zeros, stale results, paused counting and refresh errors", async () => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    http.apiRequest.mockResolvedValueOnce({
      ...pending,
      status: "ready",
      generatedAt: 1000,
      windowStartAt: 0,
      windowEndAt: 1000,
      downloadsLast24h: 0,
      downloadsAllTime: 123456,
      staleAfterAt: 2000,
      refreshInProgress: false,
      countingPaused: true,
      lastError: "Refresh failed.",
    });
    await cmdDownloads(makeGlobalOpts(), {});
    const text = output.mock.calls.map(([chunk]) => chunk).join("");
    expect(text).toContain("Last 24 hours: 0");
    expect(text).toContain("123,456");
    expect(text).toContain("STALE");
    expect(text).toContain("PAUSED");
    expect(text).toContain("Refresh failed.");
    expect(text).toContain("Not an atomic snapshot.");
  });
  it("propagates authorization or transport failures rather than manufacturing zeros", async () => {
    http.apiRequest.mockRejectedValueOnce(new Error("403 Admin role required."));
    await expect(cmdDownloads(makeGlobalOpts(), {})).rejects.toThrow("403");
  });
});

/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedSearchTelemetrySource,
  recordSearchTelemetryV1Handler,
} from "./searchTelemetryV1";

const { applyRateLimitMock } = vi.hoisted(() => ({
  applyRateLimitMock: vi.fn(),
}));

vi.mock("../lib/httpRateLimit", () => ({
  applyRateLimit: applyRateLimitMock,
  getClientIp: () => "203.0.113.10",
}));

describe("recordSearchTelemetryV1Handler", () => {
  beforeEach(() => {
    applyRateLimitMock.mockReset();
    applyRateLimitMock.mockResolvedValue({ ok: true, headers: { "x-test": "1" } });
  });

  it("records submitted search queries through the internal aggregate mutation", async () => {
    const runMutation = vi.fn().mockResolvedValue({ recorded: true });

    const response = await recordSearchTelemetryV1Handler(
      { runMutation } as never,
      new Request("https://example.com/api/v1/search/telemetry", {
        method: "POST",
        headers: { Origin: "https://clawhub.ai" },
        body: JSON.stringify({ query: "GitHub integration" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      query: "GitHub integration",
      bucketKey: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
    });
  });

  it("rejects malformed recording requests before writing", async () => {
    const runMutation = vi.fn();

    const response = await recordSearchTelemetryV1Handler(
      { runMutation } as never,
      new Request("https://example.com/api/v1/search/telemetry", {
        method: "POST",
        headers: { Origin: "https://clawhub.ai" },
        body: JSON.stringify({ query: " " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing query");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects writes from non-ClawHub browser origins before consuming rate limit", async () => {
    const runMutation = vi.fn();

    const response = await recordSearchTelemetryV1Handler(
      { runMutation } as never,
      new Request("https://example.com/api/v1/search/telemetry", {
        method: "POST",
        headers: { Origin: "https://spam.example" },
        body: JSON.stringify({ query: "GitHub integration" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Search telemetry source not allowed");
    expect(applyRateLimitMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("allows same-origin and local development telemetry sources", () => {
    expect(
      isAllowedSearchTelemetrySource(
        new Request("https://example.com/api/v1/search/telemetry", {
          headers: { Origin: "https://example.com" },
        }),
      ),
    ).toBe(true);
    expect(
      isAllowedSearchTelemetrySource(
        new Request("https://example.com/api/v1/search/telemetry", {
          headers: { Origin: "http://localhost:3000" },
        }),
      ),
    ).toBe(true);
  });
});

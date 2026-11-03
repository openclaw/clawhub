/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createHttpClient, getHttpErrorDiagnostic, getHttpErrorStatus } from "./http.js";

const writePressure =
  "Too many writes in a short period of time. Reduce your writes, spread your writes out over time or remove unused indexes to reduce load and avoid errors.";

function makeClient(runtime: "node" | "bun", status: number, body: string, retryAfter = "") {
  const fetchImpl = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "RateLimit-Reset": "53", "Retry-After": retryAfter },
      }),
  );
  const spawnSyncImpl = vi.fn(() => ({
    status: 0,
    stdout: [body, "__CLAWHUB_CURL_META__", status, "", "", "", "", "", "53", retryAfter].join(
      "\n",
    ),
    stderr: "",
  }));
  const delays: number[] = [];
  const client = createHttpClient({
    runtime,
    configureDispatcher: false,
    env: {},
    fetchImpl: fetchImpl as typeof fetch,
    spawnSyncImpl: spawnSyncImpl as unknown as typeof import("node:child_process").spawnSync,
    setTimeoutImpl: ((callback: () => void, ms: number) => {
      // Completed synthetic responses cancel their deadline; only retry sleeps fire.
      if (ms !== 15_000 && ms !== 120_000) {
        delays.push(ms);
        callback();
      }
      return 1;
    }) as unknown as typeof setTimeout,
    clearTimeoutImpl: vi.fn(),
    random: () => 0,
  });
  return { client, delays, attempts: runtime === "node" ? fetchImpl : spawnSyncImpl };
}

async function failRequest(client: ReturnType<typeof createHttpClient>) {
  return await client
    .apiRequest("https://fixture.invalid", { method: "POST", path: "/ticket" })
    .catch((error: unknown) => error);
}

for (const runtime of ["node", "bun"] as const) {
  describe(`${runtime} HTTP diagnostics`, () => {
    it.each([
      { status: 400, body: "Version already exists", expected: "Version already exists" },
      {
        status: 403,
        body: "Forbidden",
        expected:
          "Permission denied. This account does not have access to this operation, or the account is not in good standing.",
      },
      {
        status: 404,
        body: "Skill not found",
        expected: "Skill not found or unavailable to this account.",
      },
    ])(
      "preserves existing shared-client HTTP $status messages",
      async ({ status, body, expected }) => {
        const { client } = makeClient(runtime, status, body);
        const error = await failRequest(client);
        expect((error as Error).message).toBe(`${expected} (reset in 53s)`);
        expect(getHttpErrorDiagnostic(error)).toBe(`HTTP ${status}`);
      },
    );

    it.each([
      { status: 400, attempts: 1, delays: [] },
      { status: 503, attempts: 3, delays: [300, 600, 1200] },
      { status: 429, attempts: 3, delays: [53000, 53000, 53000], retryAfter: "53" },
    ])("exposes HTTP $status without changing messages or retries", async (fixture) => {
      const { client, attempts, delays } = makeClient(
        runtime,
        fixture.status,
        writePressure,
        fixture.retryAfter,
      );
      const error = await failRequest(client);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `${writePressure} (${fixture.retryAfter ? "retry in 53s, " : ""}reset in 53s)`,
      );
      expect(getHttpErrorStatus(error)).toBe(fixture.status);
      expect(attempts).toHaveBeenCalledTimes(fixture.attempts);
      expect(delays).toEqual(fixture.delays);
      expect(getHttpErrorDiagnostic(error)).toBe(`HTTP ${fixture.status}`);
      if (fixture.retryAfter) {
        expect((error as Error).message).toContain("retry in 53s");
      } else {
        expect((error as Error).message).not.toContain("retry in");
      }
    });

    it.each([400, 500])("retains a validated request ID on HTTP %i", async (status) => {
      const { client } = makeClient(runtime, status, "[Request ID: 0123456789abcdef] Server Error");
      const error = await failRequest(client);
      expect(error).toHaveProperty("requestId", "0123456789abcdef");
      expect((error as Error).message).toBe("Server Error (reset in 53s)");
      expect(getHttpErrorDiagnostic(error)).toBe(`HTTP ${status} (Request ID: 0123456789abcdef)`);
    });

    it.each([
      { label: "short", id: "abc" },
      { label: "15 digits", id: "0123456789abcde" },
      { label: "17 digits", id: "0123456789abcdef0" },
      { label: "non-hex", id: "0123456789abcdeg" },
      { label: "URL", id: "https://upload.invalid/private?token=secret" },
      { label: "newline", id: "0123456789abcdef\nAuthorization: Bearer secret" },
      { label: "terminal escape", id: "\u001b[31m0123456789abcdef" },
    ])("rejects malformed request IDs: $label", async ({ id }) => {
      const { client } = makeClient(runtime, 400, `[Request ID: ${id}] Server Error`);
      const error = await failRequest(client);
      expect(error).toHaveProperty("requestId", undefined);
      expect(getHttpErrorDiagnostic(error)).toBe("HTTP 400");
    });

    it("keeps response content and raw traces out of safe diagnostics", async () => {
      const { client } = makeClient(
        runtime,
        400,
        "[Request ID: 0123456789abcdef] Authorization: Bearer secret https://upload.invalid/private?token=secret\n    at store (internal.ts:1)\nPRIVATE FILE CONTENT",
      );
      const error = await failRequest(client);
      expect(getHttpErrorDiagnostic(error)).toBe("HTTP 400 (Request ID: 0123456789abcdef)");
    });

    it.each([401, 403, 404, 408, 409])(
      "keeps HTTP %i aborting after one attempt",
      async (status) => {
        const { client, attempts, delays } = makeClient(runtime, status, "request rejected");
        expect(getHttpErrorStatus(await failRequest(client))).toBe(status);
        expect(attempts).toHaveBeenCalledTimes(1);
        expect(delays).toEqual([]);
      },
    );

    it("preserves the existing contention retry decision", async () => {
      const { client, attempts } = makeClient(runtime, 400, "write conflict");
      expect(getHttpErrorStatus(await failRequest(client))).toBe(400);
      expect(attempts).toHaveBeenCalledTimes(3);
    });

    it("leaves accepted responses unchanged", async () => {
      const { client, attempts, delays } = makeClient(runtime, 409, '{"ok":true}');
      await expect(
        client.apiRequest("https://fixture.invalid", {
          method: "POST",
          path: "/ticket",
          acceptedStatuses: [409],
        }),
      ).resolves.toEqual({ ok: true });
      expect(attempts).toHaveBeenCalledTimes(1);
      expect(delays).toEqual([]);
    });
  });
}

it("does not treat arbitrary error text or properties as trusted diagnostics", () => {
  const forged = Object.assign(new Error("[Request ID: 0123456789abcdef] Server Error"), {
    status: 500,
    diagnostic: "Authorization: Bearer secret",
    requestId: "0123456789abcdef",
  });
  expect(getHttpErrorDiagnostic(forged)).toBeUndefined();
  expect(getHttpErrorDiagnostic(new TypeError("fetch failed"))).toBeUndefined();
});

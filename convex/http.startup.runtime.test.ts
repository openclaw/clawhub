/* @vitest-environment node */
import { expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";

vi.mock("clawhub-schema", () => {
  throw new Error("Publication schema initialized before HTTP admission");
});
vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));

it("denies a package read before initializing publication schemas or reading package data", async () => {
  vi.resetModules();
  const { default: http } = await import("./http");
  const path = "/api/v1/packages/%40maker%2Fbrief/versions/1.0.0/artifact/download";
  const route = http.lookup(path, "GET");
  expect(route).not.toBeNull();
  if (!route) throw new Error("Missing package route");
  const [action] = route;
  const runQuery = vi.fn(async () => {
    throw new Error("Denied request read package data");
  });
  const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ("config" in args) return { ok: false, retryAfter: 60_000 };
    if ("ttlMs" in args) return { action: "retained" };
    throw new Error("Unexpected mutation");
  });
  const handler = (
    action as unknown as { _handler: (ctx: ActionCtx, request: Request) => Promise<Response> }
  )._handler;
  const response = await handler(
    { runQuery, runMutation } as unknown as ActionCtx,
    new Request("https://example.invalid" + path),
  );
  expect(response.status).toBe(429);
  expect(runQuery).not.toHaveBeenCalled();
});

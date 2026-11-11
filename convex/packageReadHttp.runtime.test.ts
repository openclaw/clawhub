/* @vitest-environment node */
import { expect, it, vi } from "vitest";
vi.mock("clawhub-schema", () => {
  throw new Error("Publication schema compiler initialized in the anonymous Template reader");
});
it("registers the Template HTTP read path without publication/schema initialization", async () => {
  vi.resetModules();
  const { get } = await import("./packageReadHttp");
  const { getRegisteredHttpHandler } = await import("./lib/httpRouteRateLimit");
  expect(typeof getRegisteredHttpHandler(get)).toBe("function");
});

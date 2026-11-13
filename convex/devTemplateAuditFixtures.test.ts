import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTemplateDocument } from "../src/lib/templateDetail";
import { seed } from "./devTemplateAuditFixtures";

afterEach(() => vi.unstubAllEnvs());
describe("local Template audit fixture", () => {
  it.each(["prod:production", "dev:cloud", ""])(
    "refuses %s before any storage or database writes",
    async (deployment) => {
      vi.stubEnv("DEV_AUTH_ENABLED", "1");
      vi.stubEnv("CONVEX_DEPLOYMENT", deployment);
      vi.stubEnv("DEV_AUTH_CONVEX_DEPLOYMENT", "");
      vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
      const storage = { store: vi.fn() };
      await expect(
        (seed as unknown as { _handler: (ctx: unknown, args: {}) => Promise<unknown> })._handler(
          { storage } as never,
          {},
        ),
      ).rejects.toThrow("Local Template audit fixture only");
      expect(storage.store).not.toHaveBeenCalled();
    },
  );
  it("uses the real unified manifest and stores realistic inert files", async () => {
    vi.stubEnv("DEV_AUTH_ENABLED", "1");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:template-audit-test");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
    const blobs: Blob[] = [];
    const runMutation = vi
      .fn()
      .mockResolvedValue({ name: "openclaw-music-manager", simulated: true });
    await (seed as unknown as { _handler: (ctx: unknown, args: {}) => Promise<unknown> })._handler(
      {
        storage: {
          store: vi.fn(async (blob: Blob) => {
            blobs.push(blob);
            return "storage:test";
          }),
        },
        runMutation,
      } as never,
      {},
    );
    const text = await blobs[0].text();
    expect(parseTemplateDocument(text).manifest?.agent.id).toBe("music-manager");
    expect(blobs).toHaveLength(5);
    expect(runMutation.mock.calls[0][1].files[0].path).toBe("CLAW.md");
  });
});

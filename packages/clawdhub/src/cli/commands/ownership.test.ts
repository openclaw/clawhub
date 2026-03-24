/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "../types";

vi.mock("../authToken.js", () => ({
  requireAuthToken: vi.fn(async () => "tkn"),
}));

vi.mock("../registry.js", () => ({
  getRegistry: vi.fn(async () => "https://clawhub.ai"),
}));

const mockApiRequest = vi.fn();
vi.mock("../../http.js", () => ({
  apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequest(registry, args, schema),
}));

vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn() })),
  fail: (message: string) => {
    throw new Error(message);
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => false,
  promptConfirm: vi.fn(async () => true),
}));

const { cmdMergeSkill, cmdRenameSkill } = await import("./ownership");

function makeOpts(): GlobalOpts {
  return {
    workdir: "/work",
    dir: "/work/skills",
    site: "https://clawhub.ai",
    registry: "https://clawhub.ai",
    registrySource: "default",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ownership commands", () => {
  it("rename requires --yes when input is disabled", async () => {
    await expect(cmdRenameSkill(makeOpts(), "demo", "demo-new", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("rename calls rename endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      slug: "demo-new",
      previousSlug: "demo",
    });

    await cmdRenameSkill(makeOpts(), "Demo", "Demo-New", { yes: true }, false);

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/rename",
      }),
      expect.anything(),
    );
    const requestArgs = mockApiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"newSlug":"demo-new"');
  });

  it("merge calls merge endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      sourceSlug: "demo-old",
      targetSlug: "demo",
    });

    await cmdMergeSkill(makeOpts(), "Demo-Old", "Demo", { yes: true }, false);

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo-old/merge",
      }),
      expect.anything(),
    );
    const requestArgs = mockApiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"targetSlug":"demo"');
  });
});

/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { runPackageInspectorForPublishInternal } from "./packageInspectorNode";

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  runCheck: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  mkdtemp: vi.fn(async () => "/tmp/clawhub-plugin-inspector-test"),
  readFile: vi.fn(async () => "{}"),
  writeFile: vi.fn(),
  rm: mocks.rm,
}));
vi.mock("@openclaw/plugin-inspector", () => ({
  openClawTargets: {
    resolveVersion: vi.fn(async () => ({ version: "2026.8.1" })),
    prepare: mocks.prepare,
  },
  pluginRoot: { runCheck: mocks.runCheck },
}));

const inspect = () =>
  (
    runPackageInspectorForPublishInternal as unknown as {
      _handler: (
        ctx: ActionCtx,
        args: { packageName: string; version: string; files: [] },
      ) => Promise<{
        status: string;
        summary: { breakageCount: number; issueCount: number; warningCount: number };
        breakages: Array<{ code: string; message: string }>;
        warnings: Array<{ code: string }>;
      }>;
    }
  )._handler({} as ActionCtx, { packageName: "@example/voice", version: "1.0.0", files: [] });

describe("publish inspector workspace lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue({ status: "ok", version: "2026.8.1" });
    mocks.runCheck.mockResolvedValue({ report: { status: "pass" } });
    mocks.rm.mockResolvedValue(undefined);
  });

  it("retains the target preparation failure when workspace cleanup also fails", async () => {
    mocks.prepare.mockRejectedValue(
      Object.assign(new Error("target disk full"), { code: "ENOSPC" }),
    );
    mocks.rm.mockRejectedValue(
      Object.assign(new Error("workspace still busy"), { code: "ENOTEMPTY" }),
    );

    const result = await inspect();
    expect(result.status).toBe("fail");
    expect(result.summary).toMatchObject({ breakageCount: 2, issueCount: 2 });
    expect(result.breakages).toEqual([
      expect.objectContaining({
        code: "plugin-inspector-error",
        message: expect.stringContaining("target disk full"),
      }),
      expect.objectContaining({
        code: "plugin-inspector-cleanup-error",
        message: expect.stringContaining("workspace still busy"),
      }),
    ]);
    expect(mocks.runCheck).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/clawhub-plugin-inspector-test", {
      recursive: true,
      force: true,
    });
  });

  it("fails closed when cleanup fails after a passing inspection", async () => {
    mocks.rm.mockRejectedValue(new Error("cleanup denied"));

    const result = await inspect();
    expect(result.status).toBe("fail");
    expect(result.summary).toMatchObject({ breakageCount: 1, issueCount: 1 });
    expect(result.breakages[0]).toMatchObject({ code: "plugin-inspector-cleanup-error" });
  });

  it("preserves policy findings and warnings alongside a cleanup error", async () => {
    mocks.runCheck.mockResolvedValue({
      report: {
        breakages: [{ code: "package-entrypoint-missing", message: "entrypoint missing" }],
        warnings: [{ code: "manifest-name-missing", message: "name missing" }],
      },
    });
    mocks.rm.mockRejectedValue(new Error("cleanup denied"));

    const result = await inspect();
    expect(result.status).toBe("fail");
    expect(result.summary).toMatchObject({ breakageCount: 2, issueCount: 3, warningCount: 1 });
    expect(result.breakages.map((finding) => finding.code)).toEqual([
      "package-entrypoint-missing",
      "plugin-inspector-cleanup-error",
    ]);
    expect(result.warnings.map((finding) => finding.code)).toEqual(["manifest-name-missing"]);
  });
});

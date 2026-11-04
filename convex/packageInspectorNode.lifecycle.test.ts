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
  openClawTargets: { eligibilityVersion: vi.fn() },
  pluginRoot: { runCheck: mocks.runCheck },
  reports: { readOpenClawTargetSurface: vi.fn() },
}));
vi.mock("./lib/openClawInspectorTarget", () => ({
  prepareOpenClawInspectorTarget: mocks.prepare,
}));

const inspect = () =>
  (
    runPackageInspectorForPublishInternal as unknown as {
      _handler: (
        ctx: ActionCtx,
        args: { packageName: string; version: string; files: [] },
      ) => Promise<{
        outcome: string;
        failure?: { stage: string; reason: string; message: string };
        summary: { breakageCount: number; issueCount: number; warningCount: number };
        breakages: Array<{ code: string; message: string }>;
        warnings: Array<{ code: string }>;
      }>;
    }
  )._handler({} as ActionCtx, { packageName: "@example/voice", version: "1.0.0", files: [] });

describe("publish inspector workspace lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.prepare.mockResolvedValue({ status: "ok", version: "2026.8.1" });
    mocks.runCheck.mockResolvedValue({ report: { status: "pass" } });
    mocks.rm.mockResolvedValue(undefined);
  });

  it("reports target preparation failures as a tool failure, never a plugin breakage", async () => {
    mocks.prepare.mockRejectedValue(
      Object.assign(new Error("target disk full"), { code: "ENOSPC" }),
    );
    mocks.rm.mockRejectedValue(
      Object.assign(new Error("workspace still busy"), { code: "ENOTEMPTY" }),
    );

    const result = await inspect();
    expect(result).toMatchObject({
      outcome: "tool_failure",
      failure: {
        stage: "OpenClaw target preparation",
        reason: "target_unavailable",
        message: "target disk full",
      },
      summary: { breakageCount: 0, issueCount: 0, warningCount: 0 },
      breakages: [],
      warnings: [],
    });
    expect(mocks.runCheck).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/clawhub-plugin-inspector-test", {
      recursive: true,
      force: true,
    });
  });

  it("classifies inspection timeouts and out-of-memory errors separately", async () => {
    mocks.runCheck.mockRejectedValueOnce(new Error("TypeScript program timed out"));
    await expect(inspect()).resolves.toMatchObject({
      outcome: "timeout",
      failure: { stage: "inspection", reason: "timeout" },
      breakages: [],
    });

    mocks.runCheck.mockRejectedValueOnce(
      new Error(
        "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
      ),
    );
    await expect(inspect()).resolves.toMatchObject({
      outcome: "tool_failure",
      failure: { stage: "inspection", reason: "out_of_memory" },
      breakages: [],
    });
  });

  it("keeps a clean outcome when only workspace cleanup fails", async () => {
    mocks.rm.mockRejectedValue(new Error("cleanup denied"));

    const result = await inspect();
    expect(result).toMatchObject({ outcome: "clean", breakages: [], warnings: [] });
    expect(result).not.toHaveProperty("failure");
  });

  it("preserves plugin findings when workspace cleanup fails", async () => {
    mocks.runCheck.mockResolvedValue({
      report: {
        breakages: [{ code: "package-entrypoint-missing", message: "entrypoint missing" }],
        warnings: [{ code: "manifest-name-missing", message: "name missing" }],
      },
    });
    mocks.rm.mockRejectedValue(new Error("cleanup denied"));

    const result = await inspect();
    expect(result.outcome).toBe("findings");
    expect(result.summary).toMatchObject({ breakageCount: 1, issueCount: 2, warningCount: 1 });
    expect(result.breakages.map((finding) => finding.code)).toEqual(["package-entrypoint-missing"]);
    expect(result.warnings.map((finding) => finding.code)).toEqual(["manifest-name-missing"]);
  });
});

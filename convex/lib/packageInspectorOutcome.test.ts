import { describe, expect, it } from "vitest";
import {
  classifyPackageInspectorFailure,
  isPackageInspectorFailureOutcome,
} from "./packageInspectorOutcome";

describe("Plugin Inspector failure classification", () => {
  it("separates out-of-memory kills, timeouts, target failures, and other errors", () => {
    expect(
      classifyPackageInspectorFailure(
        new Error("Node.js action execution ran out of memory"),
        "action",
      ),
    ).toEqual({
      outcome: "tool_failure",
      failure: {
        stage: "action",
        reason: "out_of_memory",
        message: "Node.js action execution ran out of memory",
      },
    });
    expect(
      classifyPackageInspectorFailure(
        new Error("FATAL ERROR: Reached heap limit Allocation failed"),
        "inspection",
      ).failure.reason,
    ).toBe("out_of_memory");
    expect(classifyPackageInspectorFailure(new Error("request timed out"), "inspection")).toEqual({
      outcome: "timeout",
      failure: { stage: "inspection", reason: "timeout", message: "request timed out" },
    });
    expect(
      classifyPackageInspectorFailure(
        new Error("npm registry returned 503"),
        "OpenClaw target preparation",
      ).failure.reason,
    ).toBe("target_unavailable");
    expect(classifyPackageInspectorFailure("boom", "inspection")).toEqual({
      outcome: "tool_failure",
      failure: { stage: "inspection", reason: "error", message: "boom" },
    });
  });

  it("bounds and flattens stored failure messages", () => {
    const { failure } = classifyPackageInspectorFailure(
      new Error(`line one\n\nline two ${"x".repeat(500)}`),
      "inspection",
    );
    expect(failure.message.startsWith("line one line two ")).toBe(true);
    expect(failure.message).toHaveLength(300);
  });

  it("treats only tool failures and timeouts as failed outcomes", () => {
    expect(isPackageInspectorFailureOutcome("tool_failure")).toBe(true);
    expect(isPackageInspectorFailureOutcome("timeout")).toBe(true);
    expect(isPackageInspectorFailureOutcome("clean")).toBe(false);
    expect(isPackageInspectorFailureOutcome("findings")).toBe(false);
    expect(isPackageInspectorFailureOutcome(undefined)).toBe(false);
  });
});

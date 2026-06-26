import { describe, expect, it } from "vitest";
import { parseInlineCodeSummary } from "./formatInlineCodeSummary";

describe("parseInlineCodeSummary", () => {
  it("returns plain text when there are no backticks", () => {
    expect(parseInlineCodeSummary("Get current weather.")).toEqual([
      { type: "text", value: "Get current weather." },
    ]);
  });

  it("parses a single inline code span", () => {
    expect(parseInlineCodeSummary("Use the `gh` CLI.")).toEqual([
      { type: "text", value: "Use the " },
      { type: "code", value: "gh" },
      { type: "text", value: " CLI." },
    ]);
  });

  it("parses multiple inline code spans", () => {
    expect(parseInlineCodeSummary("Use `gh issue`, `gh pr`, and `gh run`.")).toEqual([
      { type: "text", value: "Use " },
      { type: "code", value: "gh issue" },
      { type: "text", value: ", " },
      { type: "code", value: "gh pr" },
      { type: "text", value: ", and " },
      { type: "code", value: "gh run" },
      { type: "text", value: "." },
    ]);
  });

  it("leaves unmatched backticks as plain text", () => {
    expect(parseInlineCodeSummary("Broken `quote")).toEqual([
      { type: "text", value: "Broken `quote" },
    ]);
  });
});

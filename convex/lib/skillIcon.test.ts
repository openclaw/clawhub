import { describe, expect, it } from "vitest";
import { normalizeSkillIconValue } from "./skillIcon";

describe("normalizeSkillIconValue", () => {
  it("returns undefined for non-string input", () => {
    expect(normalizeSkillIconValue(undefined)).toBeUndefined();
    expect(normalizeSkillIconValue(null)).toBeUndefined();
    expect(normalizeSkillIconValue(42)).toBeUndefined();
    expect(normalizeSkillIconValue({})).toBeUndefined();
    expect(normalizeSkillIconValue([])).toBeUndefined();
  });

  it("treats blank strings as unset (also clears the field on republish)", () => {
    expect(normalizeSkillIconValue("")).toBeUndefined();
    expect(normalizeSkillIconValue("   ")).toBeUndefined();
    expect(normalizeSkillIconValue("\t\n")).toBeUndefined();
  });

  it("rejects strings without a protocol prefix", () => {
    expect(normalizeSkillIconValue("Plug")).toBeUndefined();
    expect(normalizeSkillIconValue(":Plug")).toBeUndefined();
    expect(normalizeSkillIconValue("lucide")).toBeUndefined();
    expect(normalizeSkillIconValue("lucide:")).toBeUndefined();
  });

  it("normalizes the protocol to lower-case while preserving the icon name casing", () => {
    expect(normalizeSkillIconValue("lucide:Plug")).toBe("lucide:Plug");
    expect(normalizeSkillIconValue("LUCIDE:Plug")).toBe("lucide:Plug");
    expect(normalizeSkillIconValue("Lucide:FileText")).toBe("lucide:FileText");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(normalizeSkillIconValue("  lucide:Plug  ")).toBe("lucide:Plug");
  });

  it("rejects malformed lucide icon names", () => {
    expect(normalizeSkillIconValue("lucide:plug-icon")).toBeUndefined();
    expect(normalizeSkillIconValue("lucide:1Plug")).toBeUndefined();
    expect(normalizeSkillIconValue("lucide:Plug Icon")).toBeUndefined();
    expect(normalizeSkillIconValue("lucide:Plug.svg")).toBeUndefined();
  });

  it("accepts valid lucide names of mixed casing and digits", () => {
    expect(normalizeSkillIconValue("lucide:Code2")).toBe("lucide:Code2");
    expect(normalizeSkillIconValue("lucide:abc")).toBe("lucide:abc");
    expect(normalizeSkillIconValue("lucide:ABC")).toBe("lucide:ABC");
  });

  it("rejects unknown protocols (phase 1 only ships lucide)", () => {
    expect(normalizeSkillIconValue("url:https://example.com/icon.png")).toBeUndefined();
    expect(normalizeSkillIconValue("storage:abc123")).toBeUndefined();
    expect(normalizeSkillIconValue("emoji:🦾")).toBeUndefined();
  });

  it("rejects values that exceed the storage length budget", () => {
    const longName = "A".repeat(60);
    expect(normalizeSkillIconValue(`lucide:${longName}`)).toBeUndefined();
  });
});

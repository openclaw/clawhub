import { describe, expect, it } from "vitest";
import {
  assertValidSkillSlug,
  isReservedSkillSlug,
  isValidSkillSlugShape,
  normalizeSkillSlug,
  normalizeSkillSlugOrNull,
  SKILL_SLUG_CONSTRAINTS,
} from "./skillSlugValidator";

describe("normalizeSkillSlug", () => {
  it("trims and lowercases", () => {
    expect(normalizeSkillSlug("  Hello-World  ")).toBe("hello-world");
  });

  it("returns empty string for nullish", () => {
    expect(normalizeSkillSlug(undefined)).toBe("");
    expect(normalizeSkillSlug(null)).toBe("");
  });
});

describe("normalizeSkillSlugOrNull", () => {
  it("returns null for empty input", () => {
    expect(normalizeSkillSlugOrNull("   ")).toBeNull();
    expect(normalizeSkillSlugOrNull(null)).toBeNull();
  });

  it("returns normalized slug for non-empty input", () => {
    expect(normalizeSkillSlugOrNull("  MySkill  ")).toBe("myskill");
  });
});

describe("assertValidSkillSlug", () => {
  it.each([
    "abc",
    "my-cool-skill",
    "skill-123",
    "a1b",
    "123",
    "abc-def-ghi",
    "z".repeat(SKILL_SLUG_CONSTRAINTS.maxLength),
  ])("accepts valid slug %s", (slug) => {
    expect(() => assertValidSkillSlug(slug)).not.toThrow();
    expect(assertValidSkillSlug(slug)).toBe(slug.toLowerCase());
  });

  it("normalizes mixed case and whitespace before validating", () => {
    expect(assertValidSkillSlug("  My-Cool-Skill  ")).toBe("my-cool-skill");
  });

  it("silently lowercases uppercase input (legacy-compatible)", () => {
    // Historically, write paths did `args.slug.trim().toLowerCase()` before
    // validating. We preserve that behaviour: uppercase input is normalized,
    // not rejected outright.
    expect(assertValidSkillSlug("A-B-C")).toBe("a-b-c");
  });

  it.each([
    ["", "required"],
    [" ", "required"],
    ["ab", "at least"],
    ["a".repeat(SKILL_SLUG_CONSTRAINTS.maxLength + 1), "at most"],
    ["-abc", "start and end"],
    ["abc-", "start and end"],
    ["a--b", "start and end"],
    ["a---b", "start and end"],
    ["a_b", "start and end"],
    ["a.b", "start and end"],
    ["a b", "start and end"],
    ["a/b", "start and end"],
  ])("rejects invalid slug %s", (slug, hint) => {
    expect(() => assertValidSkillSlug(slug)).toThrow(new RegExp(hint, "i"));
  });

  it.each(["admin", "settings", "api", "openclaw", "clawhub", "souls", "packages"])(
    "rejects reserved slug %s",
    (slug) => {
      // Some short reserved entries (e.g. "u") are also blocked by the
      // length rule; we only assert that a throw happens for every entry.
      expect(() => assertValidSkillSlug(slug)).toThrow();
    },
  );

  it("emits the reserved-specific error for long reserved slugs", () => {
    expect(() => assertValidSkillSlug("openclaw")).toThrow(/reserved/i);
  });

  it("allows reserved slugs when allowReserved is set", () => {
    expect(() => assertValidSkillSlug("admin", { allowReserved: true })).not.toThrow();
    expect(assertValidSkillSlug("admin", { allowReserved: true })).toBe("admin");
  });
});

describe("isValidSkillSlugShape", () => {
  it("returns true for well-formed slugs", () => {
    expect(isValidSkillSlugShape("abc")).toBe(true);
    expect(isValidSkillSlugShape("my-skill-1")).toBe(true);
  });

  it("returns true for reserved slugs (shape only)", () => {
    // The reserved-word blocklist is intentionally NOT consulted here so
    // that legacy rows carrying reserved slugs remain lookup-able.
    expect(isValidSkillSlugShape("admin")).toBe(true);
  });

  it("is case-insensitive (normalizes before checking)", () => {
    // Matches legacy read-path behaviour: search queries like "My-Skill"
    // should still resolve to the slug row.
    expect(isValidSkillSlugShape("A-B")).toBe(true);
  });

  it("returns false for malformed slugs", () => {
    expect(isValidSkillSlugShape("a")).toBe(false);
    expect(isValidSkillSlugShape("ab")).toBe(false);
    expect(isValidSkillSlugShape("a--b")).toBe(false);
    expect(isValidSkillSlugShape("-abc")).toBe(false);
    expect(isValidSkillSlugShape("abc-")).toBe(false);
    expect(isValidSkillSlugShape("a_b")).toBe(false);
    expect(isValidSkillSlugShape("")).toBe(false);
    expect(isValidSkillSlugShape("a".repeat(SKILL_SLUG_CONSTRAINTS.maxLength + 1))).toBe(false);
  });
});

describe("isReservedSkillSlug", () => {
  it("identifies reserved slugs case-insensitively", () => {
    expect(isReservedSkillSlug("admin")).toBe(true);
    expect(isReservedSkillSlug("  ADMIN  ")).toBe(true);
    expect(isReservedSkillSlug("openclaw")).toBe(true);
  });

  it("returns false for non-reserved slugs", () => {
    expect(isReservedSkillSlug("my-skill")).toBe(false);
    expect(isReservedSkillSlug("")).toBe(false);
    expect(isReservedSkillSlug(null)).toBe(false);
  });
});

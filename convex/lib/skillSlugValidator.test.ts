/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  assertValidSkillSlug,
  isSearchableSkillSlugShape,
  normalizeSkillSlug,
} from "./skillSlugValidator";

describe("normalizeSkillSlug", () => {
  it("trims and lowercases", () => {
    expect(normalizeSkillSlug("  Hello-World  ")).toBe("hello-world");
    expect(normalizeSkillSlug("  MySkill  ")).toBe("myskill");
  });

  it("returns empty string for blank or nullish input", () => {
    expect(normalizeSkillSlug("   ")).toBe("");
    expect(normalizeSkillSlug(undefined)).toBe("");
    expect(normalizeSkillSlug(null)).toBe("");
  });
});

describe("assertValidSkillSlug", () => {
  it.each([
    "abc",
    "my-cool-skill",
    "my-skill-1",
    "my-skill",
    "skill-123",
    "a1b",
    "123",
    "abc-def-ghi",
    "z".repeat(96),
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

  it("allows the removed creators route slug", () => {
    expect(assertValidSkillSlug("creators")).toBe("creators");
  });

  it.each([
    ["", "required"],
    [" ", "required"],
    ["a", "at least"],
    ["ab", "at least"],
    ["a".repeat(97), "at most"],
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

  it("rejects nullish input", () => {
    expect(() => assertValidSkillSlug(undefined)).toThrow(/required/i);
    expect(() => assertValidSkillSlug(null)).toThrow(/required/i);
  });

  it.each([
    "account-banned",
    "admin",
    "  ADMIN  ",
    "settings",
    "api",
    "openclaw",
    "clawhub",
    "souls",
    "packages",
    "official",
    "publishers",
  ])("rejects reserved slug %s", (slug) => {
    // Some short reserved entries (e.g. "u") are also blocked by the
    // length rule; we only assert that a throw happens for every entry.
    expect(() => assertValidSkillSlug(slug)).toThrow();
  });

  it.each(["openclaw", "official", "publishers"])(
    "emits the reserved-specific error for long reserved slug %s",
    (slug) => {
      expect(() => assertValidSkillSlug(slug)).toThrow(/reserved/i);
    },
  );

  it.each([
    "openclaw-helper",
    "helper-openclaw",
    "official-git",
    "git-official",
    "helper-official",
  ])("rejects protected namespace slug %s", (slug) => {
    expect(() => assertValidSkillSlug(slug)).toThrow(/protected/i);
  });

  it.each(["doca-comm-channel-admin", "admin-tools", "cluster-admin"])(
    "allows descriptive slugs that contain admin as an affix: %s",
    (slug) => {
      expect(assertValidSkillSlug(slug)).toBe(slug);
    },
  );

  it("keeps the exact admin slug reserved", () => {
    expect(() => assertValidSkillSlug("admin")).toThrow(/reserved/i);
  });

  it("allows reserved and protected slugs when allowReserved is set", () => {
    expect(() => assertValidSkillSlug("admin", { allowReserved: true })).not.toThrow();
    expect(assertValidSkillSlug("admin", { allowReserved: true })).toBe("admin");
    expect(assertValidSkillSlug("openclaw-helper", { allowReserved: true })).toBe(
      "openclaw-helper",
    );
  });
});

describe("isSearchableSkillSlugShape", () => {
  it("accepts slugs shorter than the write-path minimum (legacy rows)", () => {
    // Single- and two-character slugs predate the min-length floor but may
    // still exist in the skills table. Search must surface them via the
    // exact-slug fast path.
    expect(isSearchableSkillSlugShape("a")).toBe(true);
    expect(isSearchableSkillSlugShape("ab")).toBe(true);
    expect(isSearchableSkillSlugShape("a1")).toBe(true);
  });

  it("accepts regular well-formed slugs", () => {
    expect(isSearchableSkillSlugShape("abc")).toBe(true);
    expect(isSearchableSkillSlugShape("my-skill-1")).toBe(true);
  });

  it("accepts reserved slugs (read path ignores the blocklist)", () => {
    // Legacy data may still carry reserved slugs; they must remain
    // searchable even though the write path would now reject them.
    expect(isSearchableSkillSlugShape("admin")).toBe(true);
    expect(isSearchableSkillSlugShape("u")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSearchableSkillSlugShape("A-B")).toBe(true);
    expect(isSearchableSkillSlugShape("  My-Skill  ")).toBe(true);
  });

  it("still rejects malformed shapes", () => {
    expect(isSearchableSkillSlugShape("")).toBe(false);
    expect(isSearchableSkillSlugShape("   ")).toBe(false);
    expect(isSearchableSkillSlugShape("-abc")).toBe(false);
    expect(isSearchableSkillSlugShape("abc-")).toBe(false);
    expect(isSearchableSkillSlugShape("a--b")).toBe(false);
    expect(isSearchableSkillSlugShape("a_b")).toBe(false);
    expect(isSearchableSkillSlugShape("a b")).toBe(false);
    expect(isSearchableSkillSlugShape("-")).toBe(false);
  });

  it("accepts slugs longer than the write-path upper bound (legacy rows)", () => {
    // Legacy rows predate MAX_SLUG_LENGTH and may exceed 48 chars. The read
    // path must still resolve them via the by_slug fast path; otherwise
    // searchSkills falls back to scanning only the most recent digests and
    // can miss older records entirely.
    expect(isSearchableSkillSlugShape("a".repeat(96))).toBe(true);
    expect(isSearchableSkillSlugShape("a".repeat(97))).toBe(true);
    expect(isSearchableSkillSlugShape("a".repeat(200))).toBe(true);
  });
});

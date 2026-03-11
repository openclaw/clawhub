import { describe, expect, it } from "vitest";
import { en } from "../locales/en";
import { zhCN } from "../locales/zh-CN";
import type { TranslationMap } from "../types";

/** Recursively extract all dot-path keys from a translation object. */
function flattenKeys(obj: TranslationMap, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      keys.push(path);
    } else if (typeof v === "object" && v !== null) {
      keys.push(...flattenKeys(v as TranslationMap, path));
    }
  }
  return keys.sort();
}

describe("locale parity", () => {
  const enKeys = flattenKeys(en);
  const zhKeys = flattenKeys(zhCN);

  it("en and zh-CN should have the same number of keys", () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });

  it("zh-CN should not be missing any keys from en", () => {
    const missing = enKeys.filter((k) => !zhKeys.includes(k));
    if (missing.length > 0) {
      throw new Error(
        `zh-CN is missing ${missing.length} key(s) from en:\n  ${missing.join("\n  ")}`,
      );
    }
  });

  it("zh-CN should not have extra keys not in en", () => {
    const extra = zhKeys.filter((k) => !enKeys.includes(k));
    if (extra.length > 0) {
      throw new Error(
        `zh-CN has ${extra.length} extra key(s) not in en:\n  ${extra.join("\n  ")}`,
      );
    }
  });

  it("en keys should exactly match zh-CN keys", () => {
    expect(enKeys).toEqual(zhKeys);
  });

  it("all leaf values in en should be non-empty strings", () => {
    const empty = enKeys.filter((k) => {
      const parts = k.split(".");
      let current: unknown = en;
      for (const part of parts) {
        current = (current as Record<string, unknown>)[part];
      }
      return typeof current !== "string" || current.trim() === "";
    });
    if (empty.length > 0) {
      throw new Error(`en has ${empty.length} empty value(s):\n  ${empty.join("\n  ")}`);
    }
  });
});

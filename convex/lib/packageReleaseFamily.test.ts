import { describe, expect, it } from "vitest";
import { resolvePackageReleaseFamily } from "./packageReleaseFamily";

describe("admitted plugin release family", () => {
  it.each(["code-plugin", "bundle-plugin"] as const)(
    "keeps legacy %s fallback without a release snapshot",
    (family) => {
      expect(resolvePackageReleaseFamily(family, null)).toBe(family);
      expect(resolvePackageReleaseFamily(family, {})).toBe(family);
    },
  );

  it("keeps an original bundle distinct from a later native package", () => {
    expect(resolvePackageReleaseFamily("code-plugin", { pluginFamily: "bundle-plugin" })).toBe(
      "bundle-plugin",
    );
    expect(resolvePackageReleaseFamily("code-plugin", { pluginFamily: "code-plugin" })).toBe(
      "code-plugin",
    );
  });

  it.each(["template", "skill"] as const)(
    "never loosens the %s boundary using optional plugin metadata",
    (family) => {
      expect(resolvePackageReleaseFamily(family, { pluginFamily: "bundle-plugin" })).toBe(family);
      expect(resolvePackageReleaseFamily(family, { pluginFamily: "code-plugin" })).toBe(family);
    },
  );
});

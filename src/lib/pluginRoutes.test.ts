import { describe, expect, it } from "vitest";
import {
  buildPluginDetailHref,
  buildPluginSecurityHref,
  packageNameFromScopedRoute,
  parseScopedPackageName,
} from "./pluginRoutes";

describe("plugin routes", () => {
  it("keeps scoped package routes readable", () => {
    expect(buildPluginDetailHref("@openclaw/codex")).toBe("/plugins/@openclaw/codex");
    expect(buildPluginSecurityHref("@openclaw/codex", "openclaw")).toBe(
      "/plugins/@openclaw/codex/security/openclaw",
    );
  });

  it("keeps unscoped package routes single-segment encoded", () => {
    expect(buildPluginDetailHref("demo plugin")).toBe("/plugins/demo%20plugin");
  });

  it("parses scoped package names and scoped routes", () => {
    expect(parseScopedPackageName("@openclaw/codex")).toEqual({
      scope: "@openclaw",
      name: "codex",
    });
    expect(packageNameFromScopedRoute("@openclaw", "codex")).toBe("@openclaw/codex");
    expect(packageNameFromScopedRoute("openclaw", "codex")).toBeNull();
  });
});

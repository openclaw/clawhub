import { describe, expect, it } from "vitest";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  displayPluginPackageName,
  packageNameFromScopedRoute,
  parseScopedPackageName,
} from "./pluginRoutes";

describe("plugin routes", () => {
  it("keeps scoped package routes readable", () => {
    expect(buildPluginDetailHref("@openclaw/codex")).toBe("/openclaw/plugins/codex");
    expect(buildPluginSecurityAuditHref("@openclaw/codex")).toBe(
      "/openclaw/plugins/codex/security-audit",
    );
  });

  it("keeps unscoped package routes single-segment encoded", () => {
    expect(buildPluginDetailHref("demo plugin")).toBe("/plugins/demo%20plugin");
  });

  it("uses explicit owner handles for unscoped package detail routes", () => {
    expect(buildPluginDetailHref("demo-plugin", { ownerHandle: "acme" })).toBe(
      "/acme/plugins/demo-plugin",
    );
    expect(buildPluginSecurityAuditHref("demo-plugin", { ownerHandle: "@acme" })).toBe(
      "/acme/plugins/demo-plugin/security-audit",
    );
  });

  it("parses scoped package names and scoped routes", () => {
    expect(parseScopedPackageName("@openclaw/codex")).toEqual({
      scope: "@openclaw",
      name: "codex",
    });
    expect(packageNameFromScopedRoute("@openclaw", "codex")).toBe("@openclaw/codex");
    expect(packageNameFromScopedRoute("openclaw", "codex")).toBeNull();
  });

  it("formats scoped package names for display without changing unscoped names", () => {
    expect(displayPluginPackageName("@openclaw/firecrawl-plugin")).toBe("firecrawl-plugin");
    expect(displayPluginPackageName("web-search-plus-plugin-v2")).toBe("web-search-plus-plugin-v2");
  });
});

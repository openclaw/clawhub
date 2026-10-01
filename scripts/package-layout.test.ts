/* @vitest-environment node */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as {
    name?: string;
    bin?: Record<string, string>;
    repository?: { directory?: string };
    scripts?: Record<string, string>;
    workspaces?: string[];
  };
}

describe("package layout", () => {
  it("exposes the ClawHub admin CLI without moderator compatibility aliases", () => {
    const rootPackage = readJson("package.json");
    const adminPackage = readJson("packages/clawhub-admin/package.json");

    expect(existsSync(join(repoRoot, "packages/clawhub-admin"))).toBe(true);
    expect(existsSync(join(repoRoot, "packages/clawhub-mod/package.json"))).toBe(false);
    expect(existsSync(join(repoRoot, "packages/clawhub-mod/bin/clawhub-mod.js"))).toBe(false);

    expect(rootPackage.workspaces).toContain("packages/clawhub-admin");
    expect(rootPackage.workspaces).not.toContain("packages/clawhub-mod");
    expect(rootPackage.scripts?.admin).toBe("bun packages/clawhub-admin/src/cli.ts");
    expect(rootPackage.scripts).not.toHaveProperty("mod");

    expect(adminPackage.name).toBe("@openclaw/clawhub-admin");
    expect(adminPackage.repository?.directory).toBe("packages/clawhub-admin");
    expect(adminPackage.bin).toEqual({ "clawhub-admin": "bin/clawhub-admin.js" });

    const cliSource = readFileSync(join(repoRoot, "packages/clawhub-admin/src/cli.ts"), "utf8");
    expect(cliSource).not.toContain('.command("ban-user")');
    expect(cliSource).not.toContain('.command("unban-user")');
    expect(cliSource).not.toContain('.description("Alias for');
  });
});

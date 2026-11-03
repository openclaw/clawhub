/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

function run(args: string[]) {
  return spawnSync("bun", [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAWHUB_CONFIG_PATH: "/nonexistent/template-family-proof.json" },
    timeout: 15_000,
  });
}

describe("Template CLI family admission", () => {
  it.each([
    ["package", "explore", "--family", "claw"],
    ["package", "publish", "missing.tgz", "--family", "claw", "--dry-run"],
  ])("rejects the retired family before resolving a source or registry: %j", (...args) => {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Allowed choices");
    expect(result.stderr).toContain("template");
  });

  it.each(["explore", "publish"])("documents the Template family for package %s", (command) => {
    const result = run(["package", command, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"template"');
    expect(result.stdout).not.toContain('"claw"');
    if (command === "publish") {
      expect(result.stdout).toContain("Template category overrides");
      expect(result.stdout).not.toContain("plugins and Templates (ignored)");
    }
  });
});

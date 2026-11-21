/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

function runFixture(runtime: string, file: string, args: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), "dependency-compat-"));
  const nonce = randomBytes(32).toString("hex");
  writeFileSync(join(home, ".clawhub-dependency-fixture"), nonce, { mode: 0o600 });
  try {
    const result = spawnSync(runtime, [resolve("scripts/fixtures", file), ...args], {
      cwd: home,
      env: {
        CLAWHUB_DEPENDENCY_FIXTURE_HOME: home,
        CLAWHUB_DEPENDENCY_FIXTURE_NONCE: nonce,
        HOME: home,
        USERPROFILE: home,
        PATH: process.env.PATH,
        TMPDIR: tmpdir(),
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr || String(result.error ?? result.stdout)).toBe(0);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null");
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}

it("preserves legacy Convex credentials through account selection and permission changes", () => {
  expect(runFixture(process.execPath, "convex-account-compat.mjs")).toEqual({
    legacyReadable: true,
    selection: true,
    preserved: true,
    permissions: true,
  });
});

it.each(["xdg", "legacy", "precedence"])(
  "preserves OIDC behavior with %s configuration",
  (layout) => {
    for (const packageName of ["baseline", "candidate"]) {
      expect(
        runFixture(process.execPath, "vercel-oidc-compat.mjs", [packageName, layout]),
      ).toMatchObject({
        layout,
        fresh: true,
        request: true,
        file: true,
        refresh: true,
      });
    }
  },
);

it.each([
  ["convex-account-compat.mjs", ".convex/config.json", []],
  ["vercel-oidc-compat.mjs", ".now/auth.json", ["candidate", "legacy"]],
] as const)(
  "refuses an unowned direct invocation of %s before changing credentials",
  (file, credential, args) => {
    const home = mkdtempSync(join(tmpdir(), "dependency-compat-"));
    const path = join(home, credential);
    const original = '{"token":"fixture-preexisting-credential"}';
    try {
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, original);
      const result = spawnSync(process.execPath, [resolve("scripts/fixtures", file), ...args], {
        cwd: home,
        env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, NO_COLOR: "1" },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Run through the dependency fixture runner.");
      expect(readFileSync(path, "utf8")).toBe(original);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  },
);

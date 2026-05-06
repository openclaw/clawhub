import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSource } from "./setup-worktree";

function writeWorktree(path: string, deploymentName: string) {
  mkdirSync(join(path, ".convex/local/default"), { recursive: true });
  writeFileSync(
    join(path, ".env.local"),
    `CONVEX_DEPLOYMENT=local:${deploymentName}\nVITE_CONVEX_URL=http://127.0.0.1:3210\n`,
  );
  writeFileSync(
    join(path, ".convex/local/default/config.json"),
    JSON.stringify({ deploymentName, ports: { cloud: 3210 } }),
  );
}

describe("setup-worktree", () => {
  it("honors an explicit source even when the current worktree is already configured", () => {
    const root = mkdtempSync(join(tmpdir(), "clawhub-worktree-"));
    try {
      const current = join(root, "current");
      const explicit = join(root, "explicit");
      mkdirSync(current);
      mkdirSync(explicit);
      writeWorktree(current, "current-clawhub");
      writeWorktree(explicit, "explicit-clawhub");

      expect(
        findSource(
          {
            force: false,
            from: explicit,
            quiet: true,
          },
          current,
        ).path,
      ).toBe(explicit);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

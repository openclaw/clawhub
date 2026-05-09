import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSource } from "./setup-worktree";

function writeWorktree(
  path: string,
  deploymentName: string,
  options?: {
    env?: Record<string, string | null>;
    ports?: { cloud: number; site?: number };
  },
) {
  const cloudPort = options?.ports?.cloud ?? 3210;
  const sitePort = options?.ports?.site ?? cloudPort + 1;
  const env: Record<string, string> = {
    CONVEX_DEPLOYMENT: `local:${deploymentName}`,
    VITE_CONVEX_URL: `http://127.0.0.1:${cloudPort}`,
    VITE_CONVEX_SITE_URL: `http://127.0.0.1:${sitePort}`,
    CONVEX_SITE_URL: `http://127.0.0.1:${sitePort}`,
  };

  for (const [key, value] of Object.entries(options?.env ?? {})) {
    if (value === null) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  mkdirSync(join(path, ".convex/local/default"), { recursive: true });
  writeFileSync(
    join(path, ".env.local"),
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  writeFileSync(
    join(path, ".convex/local/default/config.json"),
    JSON.stringify({ deploymentName, ports: options?.ports ?? { cloud: 3210, site: 3211 } }),
  );
}

function withSourceAndCurrent(run: (source: string, current: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "clawhub-worktree-"));
  try {
    const source = join(root, "source");
    const current = join(root, "current");
    mkdirSync(source);
    mkdirSync(current);
    run(source, current);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
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

  it("rejects local sources that point browser HTTP routes at the Convex function port", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", {
        env: { VITE_CONVEX_SITE_URL: "http://127.0.0.1:3210" },
      });

      expect(() =>
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ),
      ).toThrow(
        "VITE_CONVEX_SITE_URL port 3210 does not match .convex/local/default/config.json site port 3211",
      );
    });
  });

  it("rejects local sources without the server Convex site URL used by auth", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", { env: { CONVEX_SITE_URL: null } });

      expect(() =>
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ),
      ).toThrow(
        "CONVEX_SITE_URL is required for local Convex HTTP routes; set it to http://127.0.0.1:3211",
      );
    });
  });

  it("rejects local site URLs without an explicit site proxy port", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", {
        env: { VITE_CONVEX_SITE_URL: "http://127.0.0.1" },
      });

      expect(() =>
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ),
      ).toThrow("VITE_CONVEX_SITE_URL must include local site proxy port 3211");
    });
  });

  it("uses the configured local site port when it is not cloud port plus one", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", { ports: { cloud: 3210, site: 4321 } });

      expect(
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ).path,
      ).toBe(source);
    });
  });

  it("falls back to the next port for older local configs without a site port", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", { ports: { cloud: 3210 } });

      expect(
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ).path,
      ).toBe(source);
    });
  });
});

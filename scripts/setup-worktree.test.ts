import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeSetupResult, findSource, setupWorktree } from "./setup-worktree";

function writeWorktree(
  path: string,
  deploymentName: string,
  options?: {
    env?: Record<string, string | null>;
    adminKey?: string;
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
    JSON.stringify({
      ...(options?.adminKey ? { adminKey: options.adminKey } : {}),
      deploymentName,
      ports: options?.ports ?? { cloud: 3210, site: 3211 },
    }),
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

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

describe("setup-worktree", () => {
  it("describes copied local files and fallback links clearly", () => {
    expect(
      describeSetupResult({
        convexLinked: false,
        envLinked: false,
        mode: "local",
        sourcePath: "/repo",
      }),
    ).toBe("validated copied local .env.local and .convex");

    expect(
      describeSetupResult({
        convexLinked: true,
        envLinked: false,
        mode: "fallback",
        sourcePath: "/repo",
      }),
    ).toBe("fallback source /repo (env: existing, convex: linked)");
  });

  it("uses copied local worktree files without replacing them with symlinks", () => {
    withSourceAndCurrent((_source, current) => {
      writeWorktree(current, "local-clawhub");

      expect(
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: null,
            quiet: true,
          },
        }),
      ).toEqual({
        convexLinked: false,
        envLinked: false,
        mode: "local",
        sourcePath: current,
      });
      expect(lstatSync(join(current, ".env.local")).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(current, ".convex")).isSymbolicLink()).toBe(false);
    });
  });

  it("keeps a copied env file and links only missing Convex state from a fallback source", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub");
      mkdirSync(current, { recursive: true });
      writeFileSync(
        join(current, ".env.local"),
        "CONVEX_DEPLOYMENT=local:local-clawhub\nVITE_CONVEX_URL=http://127.0.0.1:3210\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
      );

      expect(
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: source,
            quiet: true,
          },
        }),
      ).toEqual({
        convexLinked: true,
        envLinked: false,
        mode: "fallback",
        sourcePath: source,
      });
      expect(lstatSync(join(current, ".env.local")).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(current, ".convex")).isSymbolicLink()).toBe(true);
      expect(existsSync(join(current, ".convex/local/default/config.json"))).toBe(true);
    });
  });

  it("keeps copied Convex state and links only a missing env file from a fallback source", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub");
      mkdirSync(join(current, ".convex/local/default"), { recursive: true });
      writeFileSync(
        join(current, ".convex/local/default/config.json"),
        JSON.stringify({ deploymentName: "local-clawhub", ports: { cloud: 3210, site: 3211 } }),
      );

      expect(
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: source,
            quiet: true,
          },
        }),
      ).toEqual({
        convexLinked: false,
        envLinked: true,
        mode: "fallback",
        sourcePath: source,
      });
      expect(lstatSync(join(current, ".env.local")).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(current, ".convex")).isSymbolicLink()).toBe(false);
    });
  });

  it("replaces stale copied state when forced by automated worktree setup", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub");
      writeWorktree(current, "stale-clawhub", { ports: { cloud: 4321, site: 4322 } });

      expect(
        setupWorktree({
          cwd: current,
          options: {
            force: true,
            from: source,
            quiet: true,
          },
        }),
      ).toEqual({
        convexLinked: true,
        envLinked: true,
        mode: "fallback",
        sourcePath: source,
      });
      expect(lstatSync(join(current, ".env.local")).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(current, ".convex")).isSymbolicLink()).toBe(true);
    });
  });

  it("prefers a fallback source over valid current copied state in automated worktree setup", () => {
    const root = mkdtempSync(join(tmpdir(), "clawhub-worktree-git-"));
    try {
      const source = join(root, "source");
      const current = join(root, "current");
      mkdirSync(source);
      runGit(source, ["init"]);
      runGit(source, ["checkout", "-b", "main"]);
      writeFileSync(join(source, "README.md"), "# test\n");
      runGit(source, ["add", "README.md"]);
      runGit(source, [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        "commit",
        "-m",
        "init",
      ]);
      runGit(source, ["worktree", "add", "-b", "feature", current]);
      writeWorktree(source, "local-clawhub");
      writeWorktree(current, "stale-clawhub", { ports: { cloud: 4321, site: 4322 } });

      const result = setupWorktree({
        cwd: current,
        options: {
          force: true,
          preferFallback: true,
          from: null,
          quiet: true,
        },
      });

      expect(result).toEqual({
        convexLinked: true,
        envLinked: true,
        mode: "fallback",
        sourcePath: realpathSync(source),
      });
      expect(lstatSync(join(current, ".env.local")).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(current, ".convex")).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects an invalid copied env file instead of silently keeping it", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub");
      writeFileSync(
        join(current, ".env.local"),
        "CONVEX_DEPLOYMENT=local:local-clawhub\nVITE_CONVEX_URL=http://127.0.0.1:3210\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
      );

      expect(() =>
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: source,
            quiet: true,
          },
        }),
      ).toThrow(".env.local already exists as a regular local path");
    });
  });

  it("rejects a copied env file that does not match fallback runtime URLs", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub");
      writeFileSync(
        join(current, ".env.local"),
        "CONVEX_DEPLOYMENT=local:local-clawhub\nVITE_CONVEX_URL=http://localhost:3210\nVITE_CONVEX_SITE_URL=http://127.0.0.1:3211\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
      );

      expect(() =>
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: source,
            quiet: true,
          },
        }),
      ).toThrow(".env.local already exists as a regular local path");
    });
  });

  it("rejects a copied Convex config that does not match the fallback admin key", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", { adminKey: "source-admin-key" });
      mkdirSync(join(current, ".convex/local/default"), { recursive: true });
      writeFileSync(
        join(current, ".convex/local/default/config.json"),
        JSON.stringify({
          adminKey: "stale-admin-key",
          deploymentName: "local-clawhub",
          ports: { cloud: 3210, site: 3211 },
        }),
      );

      expect(() =>
        setupWorktree({
          cwd: current,
          options: {
            force: false,
            from: source,
            quiet: true,
          },
        }),
      ).toThrow(".convex already exists as a regular local path");
    });
  });

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

  it("rejects local sources without the Convex function URL used by dev startup", () => {
    withSourceAndCurrent((source, current) => {
      writeWorktree(source, "local-clawhub", { env: { VITE_CONVEX_URL: null } });

      expect(() =>
        findSource(
          {
            force: false,
            from: source,
            quiet: true,
          },
          current,
        ),
      ).toThrow("VITE_CONVEX_URL is required for local Convex");
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

import { describe, expect, it } from "vitest";
import {
  buildForegroundArgs,
  buildEnvFileCandidates,
  buildViteArgs,
  isConvexFunctionUnavailableOutput,
  isRunningPid,
  parseArgs,
  parseEnv,
} from "./dev-worktree";

describe("dev-worktree helpers", () => {
  it("parses env files without treating inline comments as values", () => {
    expect(
      parseEnv(`
        CONVEX_DEPLOYMENT=local:local-amantus-clawdhub # team: amantus, project: clawdhub
        SITE_URL=http://localhost:3000
        HASH_VALUE=abc#123
        QUOTED_HASH="value # kept"
      `),
    ).toEqual({
      CONVEX_DEPLOYMENT: "local:local-amantus-clawdhub",
      SITE_URL: "http://localhost:3000",
      HASH_VALUE: "abc#123",
      QUOTED_HASH: "value # kept",
    });
  });

  it("uses only the local checkout env unless an env file is explicit", () => {
    expect(
      buildEnvFileCandidates({
        explicit: null,
        cwd: "/tmp/worktrees/feature",
        worktrees: [
          "/Users/me/Git/openclaw/clawhub",
          "/tmp/worktrees/feature",
          "/tmp/worktrees/other-feature",
        ],
      }),
    ).toEqual([".env.local"]);
  });

  it("keeps explicit env files authoritative", () => {
    expect(
      buildEnvFileCandidates({
        explicit: "/secure/shared.env",
        cwd: "/tmp/worktrees/feature",
        worktrees: ["/Users/me/Git/openclaw/clawhub"],
      }),
    ).toEqual(["/secure/shared.env"]);
  });

  it("recognizes Convex functions that are not queryable yet", () => {
    expect(
      isConvexFunctionUnavailableOutput(`
        Failed to run function "devSeed:seedNixSkills":
        Could not find function for 'devSeed:seedNixSkills'. Did you forget to run \`npx convex dev\`?
        No functions found.
      `),
    ).toBe(true);

    expect(isConvexFunctionUnavailableOutput("AUTH_GITHUB_ID is required")).toBe(false);
  });

  it("parses detach mode for Codex setup startup", () => {
    expect(parseArgs(["--detach", "--port", "3999"])).toMatchObject({
      detach: true,
      port: "3999",
    });
  });

  it("does not pass detach mode to the foreground child process", () => {
    expect(buildForegroundArgs(["--detach", "--port", "3999"])).toEqual(["--port", "3999"]);
  });

  it("binds Vite to the same loopback host advertised by Worktrunk", () => {
    expect(buildViteArgs("3999")).toEqual([
      "--bun",
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "3999",
    ]);
  });

  it("treats invalid detached pid file values as not running", () => {
    expect(isRunningPid(null)).toBe(false);
    expect(isRunningPid(0)).toBe(false);
    expect(isRunningPid(Number.NaN)).toBe(false);
    expect(isRunningPid(process.pid)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildEnvFileCandidates,
  isConvexFunctionUnavailableOutput,
  parseEnv,
  parseGitWorktreeList,
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

  it("discovers the primary worktree env file after the current checkout", () => {
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
    ).toEqual([".env.local", "/Users/me/Git/openclaw/clawhub/.env.local"]);
  });

  it("does not scan every sibling worktree for env files", () => {
    expect(
      buildEnvFileCandidates({
        explicit: null,
        cwd: "/tmp/worktrees/feature",
        worktrees: ["/tmp/worktrees/feature", "/tmp/worktrees/other-feature"],
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

  it("parses git worktree porcelain output", () => {
    expect(
      parseGitWorktreeList(`worktree /Users/me/Git/openclaw/clawhub
HEAD abc123
branch refs/heads/main

worktree /tmp/worktrees/feature
HEAD def456
branch refs/heads/feature
`),
    ).toEqual(["/Users/me/Git/openclaw/clawhub", "/tmp/worktrees/feature"]);
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
});

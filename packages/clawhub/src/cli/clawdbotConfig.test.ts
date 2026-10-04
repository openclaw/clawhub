/* @vitest-environment node */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHome } from "../homedir.js";
import { resolveClawdbotDefaultWorkspace } from "./clawdbotConfig.js";

const originalEnv = { ...process.env };

// Workspace values are interpolated into JSON5 string literals below. On
// Windows they contain backslashes, which JSON5 would otherwise read as
// (partially invalid) escape sequences and corrupt the stored path.
function jsonPath(value: string): string {
  return value.replace(/\\/g, "\\\\");
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveClawdbotDefaultWorkspace", () => {
  it("resolves default workspace from agents.defaults and agents.list", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-clawdbot-default-"));
    const home = join(base, "home");
    const stateDir = join(base, "state");
    const configPath = join(base, "clawdbot.json");
    const workspaceMain = join(base, "workspace-main");
    const workspaceList = join(base, "workspace-list");
    const openclawStateDir = join(base, "openclaw-state");

    process.env.HOME = home;
    process.env.CLAWDBOT_STATE_DIR = stateDir;
    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = openclawStateDir;
    process.env.OPENCLAW_CONFIG_PATH = join(openclawStateDir, "openclaw.json");

    const config = `{
      agents: {
        defaults: { workspace: "${jsonPath(workspaceMain)}", },
        list: [
          { id: 'main', workspace: "${jsonPath(workspaceList)}", default: true },
        ],
      },
    }`;
    await writeFile(configPath, config, "utf8");

    const workspace = await resolveClawdbotDefaultWorkspace();
    expect(workspace).toBe(resolve(workspaceMain));
  });

  it("falls back to default agent in agents.list when defaults missing", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-clawdbot-list-"));
    const home = join(base, "home");
    const configPath = join(base, "clawdbot.json");
    const workspaceMain = join(base, "workspace-main");
    const workspaceWork = join(base, "workspace-work");
    const openclawStateDir = join(base, "openclaw-state");

    process.env.HOME = home;
    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = openclawStateDir;
    process.env.OPENCLAW_CONFIG_PATH = join(openclawStateDir, "openclaw.json");

    const config = `{
      agents: {
        list: [
          { id: 'main', workspace: "${jsonPath(workspaceMain)}", default: true },
          { id: 'work', workspace: "${jsonPath(workspaceWork)}" },
        ],
      },
    }`;
    await writeFile(configPath, config, "utf8");

    const workspace = await resolveClawdbotDefaultWorkspace();
    expect(workspace).toBe(resolve(workspaceMain));
  });

  it("respects CLAWDBOT_STATE_DIR and CLAWDBOT_CONFIG_PATH overrides", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-clawdbot-override-"));
    const home = join(base, "home");
    const stateDir = join(base, "custom-state");
    const configPath = join(base, "config", "clawdbot.json");
    const openclawStateDir = join(base, "openclaw-state");

    process.env.HOME = home;
    process.env.CLAWDBOT_STATE_DIR = stateDir;
    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = openclawStateDir;
    process.env.OPENCLAW_CONFIG_PATH = join(openclawStateDir, "openclaw.json");

    const config = `{
      agent: { workspace: "${jsonPath(join(base, "workspace-main"))}" },
    }`;
    await mkdir(join(base, "config"), { recursive: true });
    await writeFile(configPath, config, "utf8");

    const workspace = await resolveClawdbotDefaultWorkspace();
    expect(workspace).toBe(resolve(join(base, "workspace-main")));
  });

  it("uses $HOME over os.homedir() for tilde expansion", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-home-override-"));
    const customHome = join(base, "custom-home");
    const stateDir = join(base, "state");
    const configPath = join(base, "clawdbot.json");
    const openclawStateDir = join(base, "openclaw-state");

    // On Windows resolveHome() prefers USERPROFILE over HOME, so drop it to
    // keep the test targeting the HOME fallback it documents.
    delete process.env.USERPROFILE;
    process.env.HOME = customHome;
    process.env.CLAWDBOT_STATE_DIR = stateDir;
    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = openclawStateDir;
    process.env.OPENCLAW_CONFIG_PATH = join(openclawStateDir, "openclaw.json");

    const config = `{
      agents: {
        defaults: { workspace: "~/my-workspace" },
      },
    }`;
    await writeFile(configPath, config, "utf8");

    const workspace = await resolveClawdbotDefaultWorkspace();
    expect(workspace).toBe(resolve(customHome, "my-workspace"));
    expect(resolveHome()).toBe(customHome);
  });

  it("normalizes trailing separators in $HOME", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-home-trailing-"));
    const customHome = join(base, "custom-home");

    // On Windows resolveHome() prefers USERPROFILE over HOME, so drop it to
    // keep the test targeting the HOME fallback it documents.
    delete process.env.USERPROFILE;
    process.env.HOME = `${customHome}/`;

    expect(resolveHome()).toBe(customHome);
  });

  it("supports OpenClaw configuration files", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-openclaw-"));
    const stateDir = join(base, "openclaw-state");
    const workspace = join(base, "openclaw-main");
    const configPath = join(stateDir, "openclaw.json");

    process.env.OPENCLAW_STATE_DIR = stateDir;

    await mkdir(stateDir, { recursive: true });
    const config = `{
      agents: {
        defaults: { workspace: "${jsonPath(workspace)}", },
      },
    }`;
    await writeFile(configPath, config, "utf8");

    const resolvedWorkspace = await resolveClawdbotDefaultWorkspace();
    expect(resolvedWorkspace).toBe(resolve(workspace));
  });

  it("ignores malformed clawdbot values and falls back to OpenClaw", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-clawdbot-malformed-"));
    const configPath = join(base, "clawdbot.json");
    const openclawConfigPath = join(base, "openclaw.json");
    const workspace = join(base, "openclaw-main");

    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = openclawConfigPath;

    await writeFile(
      configPath,
      "{ agents: { defaults: { workspace: 123 }, list: { default: true } } }",
      "utf8",
    );
    await writeFile(
      openclawConfigPath,
      `{ agents: { defaults: { workspace: "${jsonPath(workspace)}" } } }`,
      "utf8",
    );

    await expect(resolveClawdbotDefaultWorkspace()).resolves.toBe(resolve(workspace));
  });

  it("ignores malformed agent entries without throwing", async () => {
    const base = await mkdtemp(join(tmpdir(), "clawhub-clawdbot-malformed-list-"));
    const configPath = join(base, "clawdbot.json");

    process.env.CLAWDBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = join(base, "missing-openclaw.json");

    await writeFile(configPath, "{ agents: { list: [null, 123, { workspace: null }] } }", "utf8");

    await expect(resolveClawdbotDefaultWorkspace()).resolves.toBeNull();
  });
});

/* @vitest-environment node */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHome } from "../homedir.js";
import { resolveClawdbotDefaultWorkspace } from "./clawdbotConfig.js";

const originalEnv = { ...process.env };

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
        defaults: { workspace: "${workspaceMain}", },
        list: [
          { id: 'main', workspace: "${workspaceList}", default: true },
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
          { id: 'main', workspace: "${workspaceMain}", default: true },
          { id: 'work', workspace: "${workspaceWork}" },
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
      agent: { workspace: "${join(base, "workspace-main")}" },
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
        defaults: { workspace: "${workspace}", },
      },
    }`;
    await writeFile(configPath, config, "utf8");

    const resolvedWorkspace = await resolveClawdbotDefaultWorkspace();
    expect(resolvedWorkspace).toBe(resolve(workspace));
  });
});

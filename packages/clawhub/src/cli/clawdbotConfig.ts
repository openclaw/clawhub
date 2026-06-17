import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import JSON5 from "json5";
import { resolveHome } from "../homedir.js";

type ClawdbotConfig = {
  agent?: { workspace?: string };
  agents?: {
    defaults?: { workspace?: string };
    list?: Array<{
      id?: string;
      workspace?: string;
      default?: boolean;
    }>;
  };
};

export async function resolveClawdbotDefaultWorkspace(): Promise<string | null> {
  const config = await readClawdbotConfig();
  const openclawConfig = await readOpenclawConfig();
  if (!config && !openclawConfig) return null;

  const defaultsWorkspace = resolveUserPath(
    config?.agents?.defaults?.workspace ?? config?.agent?.workspace ?? "",
  );
  if (defaultsWorkspace) return defaultsWorkspace;

  const listedAgents = config?.agents?.list ?? [];
  const defaultAgent =
    listedAgents.find((entry) => entry.default) ??
    listedAgents.find((entry) => entry.id === "main");
  const listWorkspace = resolveUserPath(defaultAgent?.workspace ?? "");
  if (listWorkspace) return listWorkspace;

  if (!openclawConfig) return null;
  const openclawDefaults = resolveUserPath(
    openclawConfig.agents?.defaults?.workspace ?? openclawConfig.agent?.workspace ?? "",
  );
  if (openclawDefaults) return openclawDefaults;
  const openclawAgents = openclawConfig.agents?.list ?? [];
  const openclawDefaultAgent =
    openclawAgents.find((entry) => entry.default) ??
    openclawAgents.find((entry) => entry.id === "main");
  const openclawWorkspace = resolveUserPath(openclawDefaultAgent?.workspace ?? "");
  return openclawWorkspace || null;
}

function resolveClawdbotStateDir() {
  const override = process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveHome(), ".clawdbot");
}

function resolveClawdbotConfigPath() {
  const override = process.env.CLAWDBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveClawdbotStateDir(), "clawdbot.json");
}

function resolveOpenclawStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveHome(), ".openclaw");
}

function resolveOpenclawConfigPath() {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveOpenclawStateDir(), "openclaw.json");
}

function resolveUserPath(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveHome()));
  }
  return resolve(trimmed);
}

async function readClawdbotConfig(): Promise<ClawdbotConfig | null> {
  return readConfigFile(resolveClawdbotConfigPath());
}

async function readOpenclawConfig(): Promise<ClawdbotConfig | null> {
  return readConfigFile(resolveOpenclawConfigPath());
}

async function readConfigFile(path: string): Promise<ClawdbotConfig | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ClawdbotConfig;
  } catch {
    return null;
  }
}

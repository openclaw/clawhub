import { readGlobalConfig } from "../config.js";
import { tokenForRegistry } from "./registry.js";
import { fail } from "./ui.js";

export async function getOptionalAuthToken(registry?: string): Promise<string | undefined> {
  const cfg = await readGlobalConfig();
  if (!cfg?.token) return undefined;
  if (registry === undefined) return cfg.token;
  return tokenForRegistry(cfg.registry, registry, cfg.token);
}

export async function requireAuthToken(registry?: string): Promise<string> {
  const token = await getOptionalAuthToken(registry);
  if (!token) {
    if (registry === undefined) fail("Not logged in. Run: clawhub login");
    fail("Not logged in to this registry. Run: clawhub login");
  }
  return token;
}

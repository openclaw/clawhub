import { readGlobalConfig } from "../config.js";
import { tokenForRegistry } from "./registry.js";
import { fail } from "./ui.js";

// The registry is required so the saved token can only be read for the registry
// a request is about to reach. Do not add an overload that returns it unbound.
export async function getOptionalAuthToken(registry: string): Promise<string | undefined> {
  const cfg = await readGlobalConfig();
  if (!cfg?.token) return undefined;
  return tokenForRegistry(cfg.registry, registry, cfg.token);
}

export async function requireAuthToken(registry: string): Promise<string> {
  const token = await getOptionalAuthToken(registry);
  if (!token) fail("Not logged in to this registry. Run: clawhub login");
  return token;
}

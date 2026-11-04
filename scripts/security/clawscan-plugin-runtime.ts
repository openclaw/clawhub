import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// Capability discovery from the installed reviewed source, not artifact bytes
// or a rollout flag. The current pinned source has no pluginScanners override.
export async function usesWholePluginScan(env: NodeJS.ProcessEnv = process.env) {
  if (!env.CLAWSCAN_SOURCE_DIR) return false;
  const file = join(env.CLAWSCAN_SOURCE_DIR, "internal/profiles/clawhub/clawscan.yml");
  const profile = parseYaml(await readFile(file, "utf8"))?.profiles?.clawhub;
  const ids = profile?.pluginScanners;
  if (ids === undefined) return false;
  if (
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    ids[0] !== "aig-mcp" ||
    !String(profile?.judge?.command).includes("clawscan-decisions-judge")
  ) {
    throw new Error(
      "Installed ClawScan plugin profile has not qualified for the Decisions consumer",
    );
  }
  return true;
}

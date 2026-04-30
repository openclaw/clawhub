import { readGlobalConfig } from "../config.js";
import { apiRequest } from "../http.js";
import { ApiRoutes, ApiV1WhoamiResponseSchema } from "../schema/index.js";
import { DEFAULT_REGISTRY } from "./registry.js";

type AdminHelpDeps = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

export function isHelpRequest(argv: string[] = process.argv) {
  const args = argv.slice(2);
  return args.length === 0 || args[0] === "help" || args.includes("--help") || args.includes("-h");
}

export async function shouldShowAdminCommandsInHelp(deps: AdminHelpDeps = {}) {
  if (!isHelpRequest(deps.argv)) return true;

  const env = deps.env ?? process.env;
  const cfg = await readGlobalConfig();
  const token = cfg?.token?.trim();
  if (!token) return false;

  const registry =
    readFlagValue(deps.argv ?? process.argv, "--registry")?.trim() ||
    env.CLAWHUB_REGISTRY?.trim() ||
    env.CLAWDHUB_REGISTRY?.trim() ||
    cfg?.registry?.trim() ||
    DEFAULT_REGISTRY;

  try {
    const whoami = await apiRequest(
      registry,
      { method: "GET", path: ApiRoutes.whoami, token },
      ApiV1WhoamiResponseSchema,
    );
    return whoami.user.role === "admin";
  } catch {
    return false;
  }
}

function readFlagValue(argv: string[], flag: string) {
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) return args[index + 1];
    if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

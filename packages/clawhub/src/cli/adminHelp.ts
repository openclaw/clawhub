import { readGlobalConfig } from "../config.js";
import { apiRequest } from "../http.js";
import { ApiRoutes, ApiV1WhoamiResponseSchema, parseArk } from "../schema/index.js";
import { DEFAULT_REGISTRY } from "./registry.js";

type AdminHelpDeps = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  commandPaths?: CommandPathRegistry;
};

type PlatformRole = "admin" | "moderator" | "user";
export type CommandAudience = "public" | "authenticated" | "owner" | "moderator" | "admin";

type CommandPathRegistry = {
  add: (path: readonly string[]) => void;
  hasKnownLeafPrefix: (path: readonly string[]) => boolean;
};

const GLOBAL_VALUE_FLAGS = new Set(["--dir", "--registry", "--site", "--workdir"]);

export function createCommandPathRegistry(): CommandPathRegistry {
  const leafPaths: string[][] = [];
  return {
    add(path) {
      leafPaths.push([...path]);
    },
    hasKnownLeafPrefix(path) {
      return leafPaths.some((leafPath) => isPathPrefix(leafPath, path));
    },
  };
}

export function isHelpRequest(
  argv: string[] = process.argv,
  commandPaths: CommandPathRegistry = createCommandPathRegistry(),
) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args.includes("--help") || args.includes("-h")) {
    return true;
  }

  return !commandPaths.hasKnownLeafPrefix(readCommandPath(args));
}

export async function resolveHelpRole(deps: AdminHelpDeps = {}): Promise<PlatformRole | null> {
  if (!isHelpRequest(deps.argv, deps.commandPaths)) return "admin";

  const env = deps.env ?? process.env;
  const cfg = await readGlobalConfig();
  const token = cfg?.token?.trim();
  if (!token) return null;

  const registry =
    readFlagValue(deps.argv ?? process.argv, "--registry")?.trim() ||
    env.CLAWHUB_REGISTRY?.trim() ||
    env.CLAWDHUB_REGISTRY?.trim() ||
    cfg?.registry?.trim() ||
    DEFAULT_REGISTRY;

  try {
    const result = await apiRequest(
      registry,
      { method: "GET", path: ApiRoutes.whoami, token },
      ApiV1WhoamiResponseSchema,
    );
    const whoami = parseArk(ApiV1WhoamiResponseSchema, result, "Whoami response");
    const role = whoami.user.role;
    return role === "admin" || role === "moderator" || role === "user" ? role : null;
  } catch {
    return null;
  }
}

export async function shouldShowAdminCommandsInHelp(deps: AdminHelpDeps = {}) {
  return shouldShowAudienceInHelp("admin", await resolveHelpRole(deps));
}

export function shouldShowAudienceInHelp(audience: CommandAudience, role: PlatformRole | null) {
  if (audience !== "moderator" && audience !== "admin") return true;
  if (audience === "moderator") return role === "moderator" || role === "admin";
  return role === "admin";
}

export function commandOptionsForAudience(audience: CommandAudience, role: PlatformRole | null) {
  return shouldShowAudienceInHelp(audience, role) ? undefined : { hidden: true };
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

function readCommandPath(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("-")) {
      return args.slice(index).filter((candidate) => !candidate.startsWith("-"));
    }
    const [flag] = arg.split("=", 1);
    if (!arg.includes("=") && GLOBAL_VALUE_FLAGS.has(flag)) index += 1;
  }
  return [];
}

function isPathPrefix(prefix: readonly string[], path: readonly string[]) {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

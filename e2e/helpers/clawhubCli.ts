import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

const REQUEST_TIMEOUT_MS = 15_000;

try {
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: REQUEST_TIMEOUT_MS },
    }),
  );
} catch {
  // ignore dispatcher setup failures
}

export function mustGetToken() {
  const fromEnv = process.env.CLAWHUB_E2E_TOKEN?.trim() || process.env.CLAWDHUB_E2E_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

export function getAdminToken() {
  return process.env.CLAWHUB_E2E_ADMIN_TOKEN?.trim() || null;
}

export function getUserToken() {
  return process.env.CLAWHUB_E2E_USER_TOKEN?.trim() || null;
}

export function getRegistry() {
  return (
    process.env.CLAWHUB_REGISTRY?.trim() ||
    process.env.CLAWDHUB_REGISTRY?.trim() ||
    "https://clawhub.ai"
  );
}

export function getSite() {
  return (
    process.env.CLAWHUB_SITE?.trim() || process.env.CLAWDHUB_SITE?.trim() || "https://clawhub.ai"
  );
}

export function buildE2ESkillMarkdown(slug: string) {
  return `# ${slug}

## What it does

This skill is used by the ClawHub CLI end-to-end suite to verify publish, install,
update, delete, and undelete flows against a real registry.

## Usage

- Run the skill after installation to confirm the package can be discovered.
- Use the published version history to verify update behavior.
- Delete and undelete the listing to confirm ownership actions still work.

## Notes

This content is intentionally specific and non-templated so the publish pipeline
accepts it during automated tests.
`;
}

export function allowLiveMutations() {
  const value = process.env.CLAWHUB_E2E_ALLOW_MUTATIONS?.trim();
  return value === "1" || value?.toLowerCase() === "true";
}

export function shouldSeedRoleHelpTokens() {
  const value = process.env.CLAWHUB_E2E_SEED_CLI_ROLE_HELP?.trim();
  return value === "1" || value?.toLowerCase() === "true";
}

type RoleHelpTokens = {
  adminToken: string;
  userToken: string;
};

export async function makeTempConfig(registry: string, token: string | null) {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-e2e-"));
  const path = join(dir, "config.json");
  await writeFile(
    path,
    `${JSON.stringify({ registry, token: token || undefined }, null, 2)}\n`,
    "utf8",
  );
  return { dir, path };
}

export async function resolveRoleHelpTokens(registry: string): Promise<RoleHelpTokens> {
  const adminToken = getAdminToken();
  const userToken = getUserToken();
  if (adminToken && userToken) return { adminToken, userToken };

  if (!shouldSeedRoleHelpTokens()) {
    throw new Error(
      "Missing CLAWHUB_E2E_ADMIN_TOKEN/CLAWHUB_E2E_USER_TOKEN or CLAWHUB_E2E_SEED_CLI_ROLE_HELP=1",
    );
  }
  if (!isLocalRegistry(registry)) {
    throw new Error("CLAWHUB_E2E_SEED_CLI_ROLE_HELP=1 only works against local registries");
  }

  const result = spawnSync(
    "bunx",
    ["convex", "run", "--no-push", "devSeed:seedCliRoleHelpFixtures"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to seed role help fixtures:\n${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(extractLastJsonObject(result.stdout)) as {
    admin?: { token?: unknown };
    user?: { token?: unknown };
  };
  if (typeof parsed.admin?.token !== "string" || typeof parsed.user?.token !== "string") {
    throw new Error("Role help fixture seed did not return admin and user tokens");
  }
  return { adminToken: parsed.admin.token, userToken: parsed.user.token };
}

function isLocalRegistry(registry: string) {
  try {
    const hostname = new URL(registry).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Keep scanning for the actual JSON payload if Convex printed status lines first.
    }
  }
  throw new Error(`No JSON object in convex run output:\n${output}`);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Timeout")), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

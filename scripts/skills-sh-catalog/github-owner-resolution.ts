import { spawnSync } from "node:child_process";

export function resolveAuthenticatedGitHubOwner(ownerInput: string) {
  const owner = ownerInput.trim().toLowerCase();
  if (!owner) throw new Error("GitHub owner is required");
  const result = spawnSync("gh", ["api", `users/${owner}`, "--jq", "{id,login}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Authenticated GitHub owner lookup failed: ${owner}`);
  }
  const payload = JSON.parse(result.stdout) as { id?: unknown; login?: unknown };
  const id = typeof payload.id === "number" ? payload.id : Number.NaN;
  const login = typeof payload.login === "string" ? payload.login.trim().toLowerCase() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || login !== owner) {
    throw new Error(`Authenticated GitHub owner lookup returned invalid identity: ${owner}`);
  }
  return { owner, id, login };
}

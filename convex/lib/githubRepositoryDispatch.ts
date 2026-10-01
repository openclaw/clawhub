const GITHUB_REPOSITORY_DISPATCH_URL = "https://api.github.com/repos/openclaw/clawhub/dispatches";

export type GitHubRepositoryDispatchToken = {
  token: string;
  permissions: Record<string, string>;
};

export function getGitHubRepositoryDispatchPermission(permissions: Record<string, string>) {
  const contentsPermission = permissions.contents ?? "none";
  return {
    contentsPermission,
    canDispatch: contentsPermission === "write",
  };
}

export async function dispatchGitHubRepositoryEvent(
  installationToken: GitHubRepositoryDispatchToken,
  event: {
    eventType: string;
    clientPayload: Record<string, string>;
    userAgent: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  if (!getGitHubRepositoryDispatchPermission(installationToken.permissions).canDispatch) {
    return { ok: false as const, reason: "contents-write-required" as const };
  }

  const response = await fetchImpl(GITHUB_REPOSITORY_DISPATCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken.token}`,
      "Content-Type": "application/json",
      "User-Agent": event.userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: event.eventType,
      client_payload: event.clientPayload,
    }),
  });
  if (!response.ok) {
    return {
      ok: false as const,
      reason: "github-rejected" as const,
      status: response.status,
    };
  }
  return { ok: true as const };
}

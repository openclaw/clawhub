import { buildGitHubApiHeaders, isGitHubAppConfigured } from "./githubAuth";

// Share the picker's authenticated public-API transport with commit resolution.
export async function fetchGitHubApi(
  url: string,
  fetcher: typeof fetch,
  accept = "application/vnd.github+json",
  useGitHubApp = true,
) {
  const headers = await buildGitHubApiHeaders({
    userAgent: "clawhub/github-import",
    accept,
    fetchImpl: fetcher,
    useGitHubApp,
  });
  const response = await fetcher(url, { headers });
  if (
    useGitHubApp &&
    !response.ok &&
    isGitHubAppConfigured() &&
    headers.Authorization &&
    (response.status === 401 || response.status === 403 || response.status === 404)
  ) {
    const fallbackHeaders = await buildGitHubApiHeaders({
      userAgent: "clawhub/github-import",
      accept,
      fetchImpl: fetcher,
      useGitHubApp: false,
    });
    if (fallbackHeaders.Authorization !== headers.Authorization) {
      return await fetcher(url, { headers: fallbackHeaders });
    }
  }
  return response;
}

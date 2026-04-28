type GitHubAuthOptions = {
  userAgent: string;
  allowGitHubApp?: boolean;
};

export async function getGitHubApiAuthorization(options: GitHubAuthOptions) {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) return `Bearer ${token}`;

  if (!options.allowGitHubApp || !isGitHubAppConfigured()) return undefined;

  const { createInstallationToken } = await import("./githubAppAuth");
  return `Bearer ${await createInstallationToken(options.userAgent)}`;
}

function isGitHubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_INSTALLATION_ID,
  );
}

/* @vitest-environment node */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGitHubHeaders, createInstallationToken, isGitHubAppConfigured } from "./githubAppAuth";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("githubAppAuth", () => {
  it("detects GitHub App env configuration", () => {
    expect(isGitHubAppConfigured()).toBe(false);

    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", generatePrivateKeyPem());

    expect(isGitHubAppConfigured()).toBe(true);
  });

  it("mints an installation token using the existing backup signing flow", async () => {
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", generatePrivateKeyPem());
    const fetchMock = vi.fn(async () => Response.json({ token: "ghs_installation" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createInstallationToken("clawhub/test")).resolves.toBe("ghs_installation");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/456/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/),
          "User-Agent": "clawhub/test",
        }),
      }),
    );
  });

  it("builds GitHub API headers with backup-compatible auth schemes", () => {
    expect(buildGitHubHeaders("installation", "clawhub/test")).toEqual({
      Authorization: "token installation",
      Accept: "application/vnd.github+json",
      "User-Agent": "clawhub/test",
    });
    expect(buildGitHubHeaders("jwt", "clawhub/test", true)).toEqual({
      Authorization: "Bearer jwt",
      Accept: "application/vnd.github+json",
      "User-Agent": "clawhub/test",
    });
  });
});

function generatePrivateKeyPem() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

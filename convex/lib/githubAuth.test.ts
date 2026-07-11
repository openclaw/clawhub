/* @vitest-environment node */

import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGitHubApiHeaders, createGitHubAppInstallationToken } from "./githubAuth";

function stubGitHubAppEnv() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  vi.stubEnv("GITHUB_APP_ID", "3536245");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "987654");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);
}

describe("githubAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("mints a GitHub App installation token from app credentials", async () => {
    stubGitHubAppEnv();
    const fetchMock = vi.fn(async () =>
      Response.json({
        token: "ghs_app_token",
        expires_at: "2026-02-02T13:00:00Z",
        permissions: { actions: "write", contents: "read" },
      }),
    );

    await expect(
      createGitHubAppInstallationToken({ fetchImpl: fetchMock, userAgent: "clawhub/test" }),
    ).resolves.toEqual({
      token: "ghs_app_token",
      expiresAt: Date.parse("2026-02-02T13:00:00Z"),
      permissions: { actions: "write", contents: "read" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/987654/access_tokens",
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

  it("builds API headers with GitHub App auth before PAT fallback", async () => {
    stubGitHubAppEnv();
    vi.stubEnv("GITHUB_TOKEN", "ghp_pat_token");
    const fetchMock = vi.fn(async () =>
      Response.json({
        token: "ghs_app_token",
        expires_at: "2026-02-02T13:00:00Z",
      }),
    );

    await expect(
      buildGitHubApiHeaders({ fetchImpl: fetchMock, userAgent: "clawhub/test" }),
    ).resolves.toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghs_app_token",
      "User-Agent": "clawhub/test",
    });
  });

  it("falls back to GITHUB_TOKEN when GitHub App credentials are absent", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_pat_token");

    await expect(buildGitHubApiHeaders({ userAgent: "clawhub/test" })).resolves.toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghp_pat_token",
      "User-Agent": "clawhub/test",
    });
  });

  it("can skip GitHub App auth for arbitrary public resources", async () => {
    stubGitHubAppEnv();
    vi.stubEnv("GITHUB_TOKEN", "ghp_pat_token");
    const fetchMock = vi.fn();

    await expect(
      buildGitHubApiHeaders({
        fetchImpl: fetchMock,
        userAgent: "clawhub/test",
        useGitHubApp: false,
      }),
    ).resolves.toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghp_pat_token",
      "User-Agent": "clawhub/test",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

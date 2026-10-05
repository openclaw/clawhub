/* @vitest-environment node */

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  CLAWHUB_VERCEL_OWNER_ID,
  CLAWHUB_VERCEL_PROJECT,
  CLAWHUB_VERCEL_PROJECT_ID,
  CLAWHUB_VERCEL_TEAM,
  expectedVercelEnvironmentForConvexSite,
  hasValidStagingEdgeSecret,
  STAGING_EDGE_SECRET_HEADER,
  verifyClawHubVercelOidcToken,
} from "./clawhubVercelOidc";

describe("ClawHub Vercel OIDC", () => {
  it("binds each Convex site class to its Vercel environment", () => {
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://migrated-production.convex.site/api/v1/download",
        { CLAWHUB_ENV: "production" },
      ),
    ).toBe("production");
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://academic-chihuahua-392.convex.site/api/v1/download",
        { CLAWHUB_ENV: "test" },
      ),
    ).toBe("preview");
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://cheery-civet-733.convex.site/api/v1/download",
        { CLAWHUB_ENV: "staging" },
      ),
    ).toBe("preview");
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://preview-branch-123.convex.site/api/v1/download",
        { CLAWHUB_PREVIEW: "1" },
      ),
    ).toBe("preview");
    expect(expectedVercelEnvironmentForConvexSite("http://127.0.0.1:3211/api/v1/download")).toBe(
      "development",
    );
    expect(
      expectedVercelEnvironmentForConvexSite("https://attacker.example/api/v1/download", {
        CLAWHUB_ENV: "production",
      }),
    ).toBeNull();
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://unclassified.convex.site/api/v1/download",
        {},
      ),
    ).toBeNull();
  });

  it("binds Staging's preview identity to its own Convex site", () => {
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://cheery-civet-733.convex.site/api/v1/download",
        { CLAWHUB_ENV: "production" },
      ),
    ).toBeNull();
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://wry-manatee-359.convex.site/api/v1/download",
        { CLAWHUB_ENV: "staging" },
      ),
    ).toBeNull();
    expect(
      expectedVercelEnvironmentForConvexSite(
        "https://cheery-civet-733.convex.site/api/v1/download",
        { CLAWHUB_ENV: "staging", CLAWHUB_PREVIEW: "1" },
      ),
    ).toBeNull();
  });

  it("requires a separate branch secret for the Staging Convex site", () => {
    const secret = "s".repeat(48);
    const env = { CLAWHUB_ENV: "staging", CLAWHUB_STAGING_EDGE_SECRET: secret };
    const request = (value?: string) =>
      new Request("https://cheery-civet-733.convex.site/api/v1/download", {
        headers: value ? { [STAGING_EDGE_SECRET_HEADER]: value } : {},
      });

    expect(hasValidStagingEdgeSecret(request(secret), env)).toBe(true);
    expect(hasValidStagingEdgeSecret(request(), env)).toBe(false);
    expect(hasValidStagingEdgeSecret(request("wrong"), env)).toBe(false);
    expect(hasValidStagingEdgeSecret(request(secret), { CLAWHUB_ENV: "staging" })).toBe(false);
    expect(
      hasValidStagingEdgeSecret(request(secret), {
        CLAWHUB_ENV: "staging",
        CLAWHUB_STAGING_EDGE_SECRET: "short",
      }),
    ).toBe(false);
    expect(hasValidStagingEdgeSecret(request(secret), { ...env, CLAWHUB_PREVIEW: "1" })).toBe(
      false,
    );
    expect(
      hasValidStagingEdgeSecret(
        new Request("https://preview-branch-123.convex.site/api/v1/download"),
        env,
      ),
    ).toBe(false);
    expect(
      hasValidStagingEdgeSecret(
        new Request("https://preview-branch-123.convex.site/api/v1/download"),
        { CLAWHUB_ENV: "preview" },
      ),
    ).toBe(true);
  });

  it("accepts only the ClawHub project identity for the expected environment", async () => {
    const keyPair = await generateKeyPair("RS256", { extractable: true });
    const publicKey = await exportJWK(keyPair.publicKey);
    const jwks = createLocalJWKSet({ keys: [{ use: "sig", ...publicKey }] });
    const token = await new SignJWT({
      owner_id: CLAWHUB_VERCEL_OWNER_ID,
      project_id: CLAWHUB_VERCEL_PROJECT_ID,
      environment: "preview",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(`https://oidc.vercel.com/${CLAWHUB_VERCEL_TEAM}`)
      .setAudience(`https://vercel.com/${CLAWHUB_VERCEL_TEAM}`)
      .setSubject(
        `owner:${CLAWHUB_VERCEL_TEAM}:project:${CLAWHUB_VERCEL_PROJECT}:environment:preview`,
      )
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keyPair.privateKey);

    await expect(verifyClawHubVercelOidcToken(token, "preview", jwks)).resolves.toMatchObject({
      owner_id: CLAWHUB_VERCEL_OWNER_ID,
      project_id: CLAWHUB_VERCEL_PROJECT_ID,
      environment: "preview",
    });
    await expect(verifyClawHubVercelOidcToken(token, "production", jwks)).rejects.toThrow(
      "Invalid ClawHub Vercel identity",
    );
  });
});

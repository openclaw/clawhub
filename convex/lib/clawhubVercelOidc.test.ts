/* @vitest-environment node */

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  CLAWHUB_VERCEL_OWNER_ID,
  CLAWHUB_VERCEL_PROJECT,
  CLAWHUB_VERCEL_PROJECT_ID,
  CLAWHUB_VERCEL_TEAM,
  expectedVercelEnvironmentForConvexSite,
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

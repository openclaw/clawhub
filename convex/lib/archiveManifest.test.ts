/* @vitest-environment node */

import { exportPKCS8, generateKeyPair } from "jose";
import { expect, it } from "vitest";
import {
  ARCHIVE_MANIFEST_AUDIENCE,
  ARCHIVE_MANIFEST_JWS_TYPE,
  signArchivePayload,
  type SkillExportArchiveManifest,
} from "./archiveManifest";

it("keeps the 10,000-file signed export contract inside the Nitro handoff budget", async () => {
  const entries = Array.from({ length: 10_000 }, (_, index) => {
    const prefix = `alice/demo/${index}-`;
    return {
      kind: "storage" as const,
      path: `${prefix}${"x".repeat(900 - prefix.length)}`,
      url: `https://preview-branch-123.convex.cloud/api/storage/storage-${index}`,
      size: 0,
      sha256: "a".repeat(64),
    };
  });
  const manifest: SkillExportArchiveManifest = {
    schema: "clawhub.skill-export-archive-manifest.v1",
    issuer: "https://preview-branch-123.convex.site",
    audience: ARCHIVE_MANIFEST_AUDIENCE,
    issuedAt: 1_000,
    expiresAt: 31_000,
    filename: "skills-export-1-5.zip",
    entries,
    exportManifest: [
      {
        publisher: "alice",
        slug: "demo",
        sourceRef: "public-clawhub",
        version: "1.0.0",
        displayName: "Demo",
        createdAt: 1,
        updatedAt: 2,
        stats: {},
        fileCount: entries.length,
      },
    ],
  };
  const keyPair = await generateKeyPair("RS256", { extractable: true });
  const privateKey = await exportPKCS8(keyPair.privateKey);

  const token = await signArchivePayload(manifest, ARCHIVE_MANIFEST_JWS_TYPE, privateKey);

  expect(new TextEncoder().encode(token).byteLength).toBeLessThanOrEqual(16 * 1024 * 1024);
});

import { CompactSign, compactVerify, createLocalJWKSet, importPKCS8 } from "jose";
import type { MergedExportManifestEntry } from "./skillZip";

export const ARCHIVE_MANIFEST_CONTENT_TYPE = "application/vnd.clawhub.skill-archive-manifest+jws";
export const ARCHIVE_MANIFEST_AUDIENCE = "clawhub.nitro-skill-archive";
export const ARCHIVE_MANIFEST_JWS_TYPE = "clawhub-skill-archive+jws";
export const ARCHIVE_METRIC_AUDIENCE = "clawhub.convex-download-metric";
export const ARCHIVE_METRIC_JWS_TYPE = "clawhub-download-metric+jws";

export type ArchiveMetricArgs = {
  target: { kind: "skill"; id: string };
  identityKind: "user" | "ip";
  identityHash: string;
  dayStart: number;
  occurredAt?: number;
};

export type SkillArchiveManifest = {
  schema: "clawhub.skill-archive-manifest.v1";
  issuer: string;
  audience: typeof ARCHIVE_MANIFEST_AUDIENCE;
  issuedAt: number;
  expiresAt: number;
  filename: string;
  meta: {
    ownerId: string;
    slug: string;
    version: string;
    publishedAt: number;
  };
  entries: Array<{ path: string; url: string }>;
  metricToken?: string;
};

export type SkillExportArchiveManifestEntry =
  | {
      kind: "storage";
      path: string;
      url: string;
      size: number;
      sha256: string;
    }
  | {
      kind: "inline";
      path: string;
      text: string;
    };

export type SkillExportArchiveManifest = {
  schema: "clawhub.skill-export-archive-manifest.v1";
  issuer: string;
  audience: typeof ARCHIVE_MANIFEST_AUDIENCE;
  issuedAt: number;
  expiresAt: number;
  filename: string;
  entries: SkillExportArchiveManifestEntry[];
  exportManifest: MergedExportManifestEntry[];
};

export type ArchiveMetricPayload = {
  schema: "clawhub.archive-download-metric.v1";
  issuer: string;
  audience: typeof ARCHIVE_METRIC_AUDIENCE;
  issuedAt: number;
  expiresAt: number;
  metric: ArchiveMetricArgs;
};

export async function readBoundedArchiveText(
  source: Pick<Request, "headers" | "body">,
  maxBytes: number,
) {
  const contentLength = source.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return null;
  }
  const reader = source.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function signArchivePayload(
  payload: SkillArchiveManifest | SkillExportArchiveManifest | ArchiveMetricPayload,
  type: typeof ARCHIVE_MANIFEST_JWS_TYPE | typeof ARCHIVE_METRIC_JWS_TYPE,
  privateKeyPem = process.env.JWT_PRIVATE_KEY,
) {
  if (!privateKeyPem) throw new Error("JWT_PRIVATE_KEY is required to sign archive capabilities");
  const privateKey = await importPKCS8(privateKeyPem, "RS256");
  const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(payload)));
  return await new CompactSign(bytes)
    .setProtectedHeader({ alg: "RS256", typ: type })
    .sign(privateKey);
}

export async function verifyArchivePayloadWithLocalJwks(
  token: string,
  expectedType: typeof ARCHIVE_MANIFEST_JWS_TYPE | typeof ARCHIVE_METRIC_JWS_TYPE,
  jwksJson = process.env.JWKS,
): Promise<unknown> {
  if (!jwksJson) throw new Error("JWKS is required to verify archive capabilities");
  const jwks = JSON.parse(jwksJson) as Parameters<typeof createLocalJWKSet>[0];
  const verified = await compactVerify(token, createLocalJWKSet(jwks), {
    algorithms: ["RS256"],
  });
  if (verified.protectedHeader.typ !== expectedType) {
    throw new Error("Unexpected archive capability type");
  }
  return JSON.parse(new TextDecoder().decode(verified.payload)) as unknown;
}

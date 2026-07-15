import { CATALOG_FEED_ID } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import {
  catalogFeedResponseHeaders,
  catalogFeedUnavailableResponse,
  matchesEtag,
  matchesLastModified,
} from "./catalogFeedV1";

export const OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE =
  "openclaw.official-external-plugin-catalog-feed.v1";

type FeedSigningConfig = {
  keyId: string;
  privateKey: CryptoKey;
};

type SignedFeedEnvelope = {
  schemaVersion: 1;
  payloadType: typeof OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE;
  payload: string;
  signatures: readonly {
    keyId: string;
    algorithm: "ed25519";
    signature: string;
  }[];
};

function decodePkcs8PrivateKey(raw: string) {
  const normalized = raw.replaceAll("\\n", "\n").trim();
  const match =
    /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----$/m.exec(
      normalized,
    );
  if (!match?.[1]) throw new Error("ClawHub feed signing key must be PKCS#8 PEM");
  const binary = atob(match[1].replaceAll(/\s/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function resolveFeedSigningConfig(
  env: Record<string, string | undefined>,
): Promise<FeedSigningConfig | null> {
  const keyId = env.CLAWHUB_FEED_SIGNING_KEY_ID?.trim();
  const privateKeyValue = env.CLAWHUB_FEED_SIGNING_PRIVATE_KEY?.trim();
  if (!keyId || !privateKeyValue) return null;
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(keyId)) {
    throw new Error("ClawHub feed signing key id is invalid");
  }
  if (privateKeyValue.length > 16_384) {
    throw new Error("ClawHub feed signing private key is too large");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodePkcs8PrivateKey(privateKeyValue),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  if (privateKey.algorithm.name !== "Ed25519") {
    throw new Error("ClawHub feed signing key must be Ed25519");
  }
  return { keyId, privateKey };
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function dssePreAuthenticationEncoding(payloadType: string, payloadBytes: Uint8Array) {
  const encoder = new TextEncoder();
  const payloadTypeBytes = encoder.encode(payloadType);
  const prefix = encoder.encode(
    `DSSEv1 ${payloadTypeBytes.length} ${payloadType} ${payloadBytes.length} `,
  );
  return concatBytes(prefix, payloadBytes);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function toHex(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

export async function signCatalogFeedPayload(
  payload: string,
  config: FeedSigningConfig,
): Promise<{ envelope: SignedFeedEnvelope; body: string; sha256: string }> {
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      config.privateKey,
      dssePreAuthenticationEncoding(OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE, payloadBytes),
    ),
  );
  const envelope: SignedFeedEnvelope = {
    schemaVersion: 1,
    payloadType: OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE,
    payload: base64UrlEncode(payloadBytes),
    signatures: [
      {
        keyId: config.keyId,
        algorithm: "ed25519",
        signature: base64UrlEncode(signature),
      },
    ],
  };
  const body = JSON.stringify(envelope);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return {
    envelope,
    body,
    sha256: toHex(new Uint8Array(digest)),
  };
}

export async function signedCatalogFeedV1Handler(
  ctx: ActionCtx,
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  let signingConfig: FeedSigningConfig | null;
  try {
    signingConfig = await resolveFeedSigningConfig(env);
  } catch {
    return catalogFeedUnavailableResponse("Signed catalog feed is unavailable");
  }
  if (!signingConfig) {
    return catalogFeedUnavailableResponse("Signed catalog feed is unavailable");
  }

  const publication = await ctx.runQuery(internal.catalogFeed.getLatestPublication, {
    feedId: CATALOG_FEED_ID,
  });
  if (!publication) return catalogFeedUnavailableResponse();

  const signed = await signCatalogFeedPayload(publication.payload, signingConfig);
  const etag = `"sha256:${signed.sha256}"`;
  const headers = catalogFeedResponseHeaders(publication, {
    representationSha256: signed.sha256,
    additionalHeaders: {
      "X-Catalog-Payload-SHA256": publication.payloadSha256,
      "X-OpenClaw-Feed-Signing-Key-ID": signingConfig.keyId,
    },
  });
  if (
    matchesEtag(request, etag) ||
    (!request.headers.has("if-none-match") && matchesLastModified(request, publication.publishedAt))
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(signed.body, { status: 200, headers });
}

export const signedCatalogFeedV1Http = httpAction(signedCatalogFeedV1Handler);

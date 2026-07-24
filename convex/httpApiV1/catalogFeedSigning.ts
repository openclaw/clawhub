import { ApiRoutes, CATALOG_FEED_ID } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import {
  catalogFeedV1Handler,
  catalogFeedResponseHeaders,
  catalogFeedUnavailableResponse,
  matchesEtag,
} from "./catalogFeedV1";

export const OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE =
  "openclaw.official-external-plugin-catalog-feed.v1";

export type FeedSigningConfig = {
  keyId: string;
  privateKey: CryptoKey;
};

type SignedFeedEnvelope = {
  payloadType: string;
  payload: string;
  signatures: readonly {
    keyid: string;
    sig: string;
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
  const rawConfig = env.CLAWHUB_FEED_SIGNING_CONFIG?.trim();
  if (!rawConfig) return null;
  if (rawConfig.length > 32_768) throw new Error("ClawHub feed signing config is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("ClawHub feed signing config must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ClawHub feed signing config must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "keyId,privateKey" ||
    typeof record.keyId !== "string" ||
    typeof record.privateKey !== "string"
  ) {
    throw new Error("ClawHub feed signing config must contain only keyId and privateKey");
  }
  const keyId = record.keyId.trim();
  const privateKeyValue = record.privateKey.trim();
  if (!keyId || !privateKeyValue) {
    throw new Error("ClawHub feed signing config fields must not be empty");
  }
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

export async function signFeedPayload(
  payloadType: string,
  payload: string,
  config: FeedSigningConfig,
): Promise<{ envelope: SignedFeedEnvelope; body: string; sha256: string }> {
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      config.privateKey,
      dssePreAuthenticationEncoding(payloadType, payloadBytes),
    ),
  );
  const envelope: SignedFeedEnvelope = {
    payloadType,
    payload: base64UrlEncode(payloadBytes),
    signatures: [
      {
        keyid: config.keyId,
        sig: base64UrlEncode(signature),
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

export async function signCatalogFeedPayload(payload: string, config: FeedSigningConfig) {
  return await signFeedPayload(OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE, payload, config);
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

  const [publication, shardPublication] = await Promise.all([
    ctx.runQuery(internal.catalogFeed.getLatestPublication, {
      feedId: CATALOG_FEED_ID,
    }),
    ctx.runQuery(internal.catalogFeedShards.getLatestCatalogFeedShardPublication, {
      feedId: CATALOG_FEED_ID,
      now: new Date().toISOString(),
    }),
  ]);
  if (shardPublication && (!publication || shardPublication.sequence > publication.sequence)) {
    return new Response(null, {
      status: 308,
      headers: mergeHeaders(
        {
          Location: ApiRoutes.catalogFeedShardRoot.replace(/^\/api/u, ""),
          "Cache-Control": "no-store",
        },
        corsHeaders(),
      ),
    });
  }
  if (!publication) return catalogFeedUnavailableResponse();

  const signed = await signCatalogFeedPayload(publication.payload, signingConfig);
  const etag = `"sha256:${signed.sha256}"`;
  const headers = new Headers(
    catalogFeedResponseHeaders(publication, {
      representationSha256: signed.sha256,
      additionalHeaders: {
        "Content-Type": "application/vnd.dsse+json; charset=utf-8",
        "X-Catalog-Payload-SHA256": publication.payloadSha256,
        "X-OpenClaw-Feed-Signing-Key-ID": signingConfig.keyId,
      },
    }),
  );
  headers.delete("Last-Modified");
  if (matchesEtag(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(signed.body, { status: 200, headers });
}

function acceptsSignedCatalogFeed(request: Request) {
  return (request.headers.get("Accept") ?? "").split(",").some((value) => {
    const [mediaType, ...parameters] = value.split(";").map((part) => part.trim());
    const disabled = parameters.some((parameter) => /^q=0(?:\.0*)?$/u.test(parameter));
    return mediaType?.toLowerCase() === "application/vnd.dsse+json" && !disabled;
  });
}

function addAcceptVary(response: Response) {
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  const values = new Set(
    (vary ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add("Accept");
  headers.set("Vary", [...values].join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function negotiatedCatalogFeedV1Handler(
  ctx: ActionCtx,
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const response = acceptsSignedCatalogFeed(request)
    ? await signedCatalogFeedV1Handler(ctx, request, env)
    : await catalogFeedV1Handler(ctx, request);
  return addAcceptVary(response);
}

// Installing this handler does not activate signing. The unsigned representation
// remains the default, and signing is reached only through explicit Accept
// negotiation plus an active signing configuration.
export const catalogFeedWithOptionalSigningV1Http = httpAction(negotiatedCatalogFeedV1Handler);

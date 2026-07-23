import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifyDetached,
} from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-feed.v1";

type Options = {
  keyId: string;
  publicKeyOut: string;
  target: "prod" | { deployment: string };
  verifyUrl?: string;
};

function usage(): never {
  throw new Error(
    "Usage: bun scripts/provision-catalog-feed-signing-key.ts --key-id <id> --public-key-out <path> (--prod | --deployment <name>) [--verify-url <url>]",
  );
}

export function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prod") {
      flags.add(arg);
      continue;
    }
    if (!arg?.startsWith("--")) usage();
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(arg, value);
    index += 1;
  }
  const keyId = values.get("--key-id")?.trim();
  const publicKeyOut = values.get("--public-key-out")?.trim();
  const deployment = values.get("--deployment")?.trim();
  if (!keyId || !publicKeyOut || !/^[A-Za-z0-9._:-]{1,128}$/u.test(keyId)) usage();
  if (flags.has("--prod") === Boolean(deployment)) usage();
  return {
    keyId,
    publicKeyOut: resolve(publicKeyOut),
    target: deployment ? { deployment } : "prod",
    verifyUrl: values.get("--verify-url")?.trim(),
  };
}

function dsseInput(payload: Buffer) {
  const type = Buffer.from(PAYLOAD_TYPE, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} ${PAYLOAD_TYPE} ${payload.length} `, "utf8"),
    payload,
  ]);
}

async function verifyEndpoint(url: string, publicKey: string, keyId: string) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.dsse+json" } });
  if (!response.ok) throw new Error(`Signed feed verification failed with HTTP ${response.status}`);
  const envelope = (await response.json()) as {
    payloadType?: string;
    payload?: string;
    signatures?: { keyid?: string; sig?: string }[];
  };
  const signature = envelope.signatures?.find((candidate) => candidate.keyid === keyId);
  if (envelope.payloadType !== PAYLOAD_TYPE || !envelope.payload || !signature?.sig) {
    throw new Error("Signed feed returned an unexpected DSSE envelope");
  }
  const payload = Buffer.from(envelope.payload, "base64url");
  if (
    !verifyDetached(
      null,
      dsseInput(payload),
      createPublicKey(publicKey),
      Buffer.from(signature.sig, "base64url"),
    )
  ) {
    throw new Error("Signed feed signature verification failed");
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (existsSync(options.publicKeyOut)) {
    throw new Error(`Refusing to overwrite existing public key: ${options.publicKeyOut}`);
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const config = JSON.stringify({ keyId: options.keyId, privateKey });
  const targetArgs =
    options.target === "prod" ? ["--prod"] : ["--deployment", options.target.deployment];
  // Persist the non-secret half first so a successful secret write can never
  // activate a signer whose matching trust anchor was lost locally.
  await writeFile(options.publicKeyOut, publicKey, { encoding: "utf8", flag: "wx" });
  const child = spawnSync(
    process.execPath,
    ["x", "convex", "env", "set", "CLAWHUB_FEED_SIGNING_CONFIG", ...targetArgs],
    { input: config, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (child.error || child.status !== 0) {
    throw new Error(
      `Convex did not confirm the signing configuration${child.error ? `: ${child.error.message}` : ""}; public key retained at ${options.publicKeyOut} for recovery checks`,
    );
  }

  const fingerprint = createHash("sha256")
    .update(createPublicKey(publicKey).export({ type: "spki", format: "der" }))
    .digest("hex");
  console.log(`keyId=${options.keyId}`);
  console.log(`publicKey=${options.publicKeyOut}`);
  console.log(`spkiSha256=${fingerprint}`);
  console.log("The private key was sent directly to Convex and was not written or printed.");
  if (options.verifyUrl) await verifyEndpoint(options.verifyUrl, publicKey, options.keyId);
}

if (import.meta.main) await main();

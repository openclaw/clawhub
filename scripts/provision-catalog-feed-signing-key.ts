import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifyDetached,
} from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ACTIVE_CONFIG_NAME = "CLAWHUB_FEED_SIGNING_CONFIG";
const PENDING_CONFIG_NAME = "CLAWHUB_FEED_SIGNING_PENDING_CONFIG";
const PAYLOAD_TYPE = "openclaw.official-external-plugin-catalog-feed.v1";

type Target = "prod" | { deployment: string };

type PrepareOptions = {
  command: "prepare";
  keyId: string;
  publicKeyOut: string;
  target: Target;
};

type ActivateOptions = {
  command: "activate";
  keyId: string;
  publicKey: string;
  target: Target;
  verifyUrl?: string;
};

export type Options = PrepareOptions | ActivateOptions;

export type ConvexRunner = (args: string[], input?: string) => string;

type Dependencies = {
  runConvex?: ConvexRunner;
  verifyFeed?: (url: string, publicKey: string, keyId: string) => Promise<void>;
};

function usage(): never {
  throw new Error(
    "Usage: ... prepare --key-id <id> --public-key-out <path> (--prod | --deployment <name>)\n" +
      "   or: ... activate --key-id <id> --public-key <path> (--prod | --deployment <name>) [--verify-url <url>]",
  );
}

function parseTarget(values: Map<string, string>, flags: Set<string>): Target {
  const deployment = values.get("--deployment")?.trim();
  if (flags.has("--prod") === Boolean(deployment)) usage();
  return deployment ? { deployment } : "prod";
}

export function parseOptions(args: string[]): Options {
  const [command, ...optionArgs] = args;
  if (command !== "prepare" && command !== "activate") usage();
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const allowedValues = new Set([
    "--key-id",
    "--public-key-out",
    "--public-key",
    "--deployment",
    "--verify-url",
  ]);
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === "--prod") {
      flags.add(arg);
      continue;
    }
    if (!arg || !allowedValues.has(arg)) usage();
    const value = optionArgs[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(arg, value);
    index += 1;
  }
  const keyId = values.get("--key-id")?.trim();
  if (!keyId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(keyId)) usage();
  const target = parseTarget(values, flags);
  if (command === "prepare") {
    const publicKeyOut = values.get("--public-key-out")?.trim();
    if (!publicKeyOut || values.has("--public-key") || values.has("--verify-url")) usage();
    return { command, keyId, publicKeyOut: resolve(publicKeyOut), target };
  }
  const publicKey = values.get("--public-key")?.trim();
  if (!publicKey || values.has("--public-key-out")) usage();
  return {
    command,
    keyId,
    publicKey: resolve(publicKey),
    target,
    verifyUrl: values.get("--verify-url")?.trim(),
  };
}

function targetArgs(target: Target) {
  return target === "prod" ? ["--prod"] : ["--deployment", target.deployment];
}

function runConvex(args: string[], input?: string) {
  const child = spawnSync(process.execPath, ["x", "convex", ...args], {
    ...(input === undefined ? {} : { input }),
    encoding: "utf8",
    stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
  });
  if (child.error || child.status !== 0) {
    throw new Error(
      `Convex command did not complete${child.error ? `: ${child.error.message}` : ` (exit ${child.status ?? "unknown"})`}`,
    );
  }
  return child.stdout ?? "";
}

function parseSigningConfig(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error("Pending signing config is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Pending signing config is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "keyId,privateKey" ||
    typeof record.keyId !== "string" ||
    typeof record.privateKey !== "string"
  ) {
    throw new Error("Pending signing config has an unexpected shape");
  }
  return { keyId: record.keyId, privateKey: record.privateKey };
}

function publicKeyDer(pem: string) {
  return createPublicKey(pem).export({ type: "spki", format: "der" });
}

function publicKeyFingerprint(pem: string) {
  return createHash("sha256").update(publicKeyDer(pem)).digest("hex");
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

export async function prepareSigningKey(options: PrepareOptions, dependencies: Dependencies = {}) {
  if (existsSync(options.publicKeyOut)) {
    throw new Error(`Refusing to overwrite existing public key: ${options.publicKeyOut}`);
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(options.publicKeyOut, publicKey, { encoding: "utf8", flag: "wx" });
  const config = JSON.stringify({ keyId: options.keyId, privateKey });
  const runner = dependencies.runConvex ?? runConvex;
  try {
    runner(["env", "set", PENDING_CONFIG_NAME, ...targetArgs(options.target)], config);
  } catch (error) {
    throw new Error(
      `Pending-secret storage was not confirmed; public key retained at ${options.publicKeyOut} for recovery checks: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return { fingerprint: publicKeyFingerprint(publicKey), publicKey: options.publicKeyOut };
}

export async function activateSigningKey(
  options: ActivateOptions,
  dependencies: Dependencies = {},
) {
  const runner = dependencies.runConvex ?? runConvex;
  const pendingRaw = runner(["env", "get", PENDING_CONFIG_NAME, ...targetArgs(options.target)]);
  const pending = parseSigningConfig(pendingRaw);
  if (pending.keyId !== options.keyId) {
    throw new Error(`Pending signing key id is ${pending.keyId}, not ${options.keyId}`);
  }
  const reviewedPublicKey = await readFile(options.publicKey, "utf8");
  const derivedPublicKey = createPublicKey(pending.privateKey).export({
    type: "spki",
    format: "pem",
  });
  if (!publicKeyDer(reviewedPublicKey).equals(publicKeyDer(derivedPublicKey))) {
    throw new Error("Pending private key does not match the reviewed public key");
  }

  const config = JSON.stringify(pending);
  runner(["env", "set", ACTIVE_CONFIG_NAME, ...targetArgs(options.target)], config);
  try {
    runner(["env", "remove", PENDING_CONFIG_NAME, ...targetArgs(options.target)]);
  } catch (error) {
    throw new Error(
      `Signer activated, but pending-secret cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const fingerprint = publicKeyFingerprint(reviewedPublicKey);
  if (options.verifyUrl) {
    try {
      await (dependencies.verifyFeed ?? verifyEndpoint)(
        options.verifyUrl,
        reviewedPublicKey,
        options.keyId,
      );
    } catch (error) {
      throw new Error(
        `Signer activated and pending secret removed, but endpoint verification failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return { fingerprint, publicKey: options.publicKey };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const result =
    options.command === "prepare"
      ? await prepareSigningKey(options)
      : await activateSigningKey(options);
  console.log(`phase=${options.command}`);
  console.log(`keyId=${options.keyId}`);
  console.log(`publicKey=${result.publicKey}`);
  console.log(`spkiSha256=${result.fingerprint}`);
  console.log(
    options.command === "prepare"
      ? "The private key is pending in Convex and is not active."
      : "The reviewed pending key is active and the pending secret was removed.",
  );
}

if (import.meta.main) await main();

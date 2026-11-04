import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runWorkerCommand } from "../lib/runWorkerCommand";

export function requireDiagnosticRecipient(value: string | undefined) {
  // Native X25519 recipients only; age validates the checksum before encryption.
  if (!value || !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(value))
    throw new Error("Fixed original diagnostic requires an age X25519 recipient");
  return value;
}

export function diagnosticEvidenceContainsCredential(
  bytes: Buffer,
  credentials: readonly string[],
) {
  for (const value of credentials) {
    if (!value) continue;
    const secret = Buffer.from(value);
    if (bytes.includes(secret)) return true;
    // Match the existing capture policy for unresolved credential prefixes at EOF.
    for (let size = Math.min(bytes.length, secret.length - 1); size > 0; size--)
      if (bytes.subarray(bytes.length - size).equals(secret.subarray(0, size))) return true;
  }
  return false;
}

export async function encryptDiagnosticEvidence(options: {
  privateRoot: string;
  output: string;
  recipient: string;
  ageBinary: string;
  runId: string;
  source: string;
  manifestSha256: string;
}) {
  const recipient = requireDiagnosticRecipient(options.recipient);
  if (!/^\d+$/.test(options.runId)) throw new Error("Invalid diagnostic run identity");
  const archive = join(options.privateRoot, "capture.tar.gz");
  const ciphertext = join(options.privateRoot, "capture.tar.gz.age.partial");
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8" };
  let ownsOutput = false;
  const run = (command: string, args: string[]) =>
    runWorkerCommand(command, args, {
      cwd: options.privateRoot,
      env,
      timeoutMs: 120_000,
      cleanupProcessGroup: true,
      commandLabel: "Private diagnostic encryption",
    });
  try {
    await run("tar", ["-czf", archive, "-C", options.privateRoot, "evidence"]);
    await run(options.ageBinary, [
      "--encrypt",
      "--recipient",
      recipient,
      "--output",
      ciphertext,
      archive,
    ]);
    const info = await lstat(ciphertext);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 100)
      throw new Error("Diagnostic encryption did not produce ciphertext");
    const bytes = await readFile(ciphertext);
    if (!bytes.subarray(0, 22).equals(Buffer.from("age-encryption.org/v1\n")))
      throw new Error("Diagnostic ciphertext header mismatch");
    const receipt = {
      schemaVersion: "clawscan-encrypted-diagnostic-v1",
      runId: options.runId,
      source: options.source,
      originalManifestSha256: options.manifestSha256,
      recipient,
      ciphertextBytes: info.size,
      ciphertextSha256: createHash("sha256").update(bytes).digest("hex"),
      plaintextUploaded: false,
      publicationClaimed: false,
    };
    // This destination contains only completed ciphertext and bounded metadata.
    await mkdir(options.output, { mode: 0o700 });
    ownsOutput = true;
    await rename(ciphertext, join(options.output, "capture.tar.gz.age"));
    await writeFile(join(options.output, "receipt.json"), JSON.stringify(receipt, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    return receipt;
  } catch {
    if (ownsOutput) await rm(options.output, { recursive: true, force: true });
    throw new Error("Diagnostic evidence encryption failed; no artifact may be uploaded");
  } finally {
    await rm(archive, { force: true });
    await rm(ciphertext, { force: true });
  }
}

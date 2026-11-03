import { createHash } from "node:crypto";
import {
  downloadFixedSkill,
  materializeFixedSkill,
  ORIGINAL038_SOURCE,
} from "./clawscan-diagnostic-fixed038";
import registry from "./diagnostic-capture/fixed-originals.json";

export const FIXED_SKILL_REGISTRY_SHA256 =
  "da4a721fe5cfc70db4d5328b8a08b6349052ce363615e363f7d0930a65555b30";

export function validateFixedSkillRegistry(value: unknown) {
  if (
    createHash("sha256").update(JSON.stringify(value)).digest("hex") !== FIXED_SKILL_REGISTRY_SHA256
  )
    throw new Error("Fixed original registry identity differs");
  return value as typeof registry;
}

const approved = validateFixedSkillRegistry(registry);
if (approved.source !== ORIGINAL038_SOURCE)
  throw new Error("Fixed original registry source differs");
export const FIXED_ORIGINAL_SELECTORS = [
  "original-038-encrypted",
  "original-079-encrypted",
  ...approved.originals.map((entry) => entry.selector),
];

export function selectFixedSkill(fixture: string) {
  const entry = approved.originals.find((value) => value.fixture === fixture);
  if (!entry) throw new Error("Only fixed originals are supported");
  // Copy the sealed value: callers cannot mutate the registry for a later selection.
  const identity = structuredClone(entry);
  const manifest = {
    archiveSha256: "0".repeat(64),
    manifestSha256: identity.manifestSha256,
    files: identity.files,
  };
  return {
    id: identity.id,
    package: identity.package,
    version: identity.version,
    manifest,
    identity,
    registrySha256: FIXED_SKILL_REGISTRY_SHA256,
    download: () => downloadFixedSkill(identity.download),
    materialize: (archive: Buffer, target: string) =>
      materializeFixedSkill(archive, target, manifest),
  };
}

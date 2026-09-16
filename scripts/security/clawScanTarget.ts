import { lstat } from "node:fs/promises";
import { join } from "node:path";

export async function resolveClawScanTargetForRoot(input: {
  artifactKind: "packageRelease" | "skill";
  root: string;
  workspace: string;
}) {
  const manifests = ["SKILL.md", "openclaw.plugin.json"] as const;
  const present = await Promise.all(
    manifests.map(async (name) =>
      (await lstat(join(input.workspace, input.root, name)).catch(() => null))?.isFile(),
    ),
  );
  // ClawScan rejects dual-manifest directories. An explicit manifest selects the
  // claimed kind while ClawScan still scans the entire dual-layout directory.
  return present.every(Boolean)
    ? `${input.root}/${manifests[input.artifactKind === "packageRelease" ? 1 : 0]}`
    : input.root;
}

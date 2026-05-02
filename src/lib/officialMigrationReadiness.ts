import type { Id } from "../../convex/_generated/dataModel";

type MigrationReadinessState =
  | "package-missing"
  | "release-missing"
  | "clawpack-missing"
  | "metadata-incomplete"
  | "scan-blocked"
  | "ready-for-openclaw";

export type MigrationReadinessItem = {
  bundledPluginId: string;
  displayName: string;
  desiredPackageName: string;
  publisherHandle: string;
  sourceRepo: string | null;
  sourcePath: string;
  sourceCommit: string | null;
  sourceRef: string | null;
  requiredHostTargets: string[];
  readinessState: MigrationReadinessState;
  blockers: string[];
  gates: {
    packageExists: boolean;
    releaseExists: boolean;
    clawpackAvailable: boolean;
    hostMatrixComplete: boolean;
    environmentComplete: boolean;
    sourceLinked: boolean;
    scanClear: boolean;
    runtimeBundleStatus: string;
  };
  package: {
    packageId: Id<"packages">;
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    runtimeId: string | null;
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    scanStatus: string;
    updatedAt: number;
  } | null;
  latestRelease: {
    releaseId: Id<"packageReleases">;
    version: string;
    createdAt: number;
    clawpackSha256: string | null;
    clawpackFileCount: number | null;
    clawpackRevokedAt?: number;
    hostTargetKeys: string[];
    environmentFlags: string[];
    scanStatus: string;
  } | null;
};

export type MigrationReadinessResult = {
  items: MigrationReadinessItem[];
  readyCount: number;
  blockedCount: number;
  generatedAt: number;
};

export function readinessStateLabel(state: MigrationReadinessState) {
  if (state === "clawpack-missing") return "claw pack missing";
  return state.replaceAll("-", " ");
}

export function readinessBlockerLabel(blocker: string) {
  if (blocker === "clawpack-missing") {
    return "claw pack missing";
  }
  return blocker.replaceAll("-", " ");
}

export function formatReadinessClawPack(item: MigrationReadinessItem) {
  if (item.latestRelease?.clawpackRevokedAt) return "revoked";
  if (!item.latestRelease?.clawpackSha256) return "missing";
  const digest = item.latestRelease.clawpackSha256.slice(0, 12);
  const count = item.latestRelease.clawpackFileCount;
  return [count ? `${count} files` : null, digest].filter(Boolean).join(" / ");
}

export function formatReadinessSource(item: MigrationReadinessItem) {
  const ref = item.sourceCommit ?? item.sourceRef;
  return `${item.sourceRepo ?? "missing"}${ref ? ` @ ${ref.slice(0, 12)}` : ""}`;
}

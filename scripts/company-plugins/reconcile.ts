import semver from "semver";
import type { CuratedPluginImport } from "../../packages/schema/src/packages";
import { buildImportPlan, type prepareBatch } from "./import";

type Release = {
  version: string;
  status: "pending" | "published" | "blocked";
  scanStatus?: string;
  curation?: CuratedPluginImport;
  source?: { repo: string; path: string };
};
export type SyncState = {
  deleted: boolean;
  staffCustody: boolean;
  latest?: Release;
  matching?: Release;
  requested?: Release;
} | null;
type Batch = Awaited<ReturnType<typeof prepareBatch>>;
export async function reconcileBatch(
  batch: Batch,
  readState: (name: string, hash: string, version: string) => Promise<SyncState>,
  scheduled = false,
) {
  const changes: Array<{ name: string; status: string; reason: string; version?: string }> = [];
  const prepared: Batch["prepared"] = [];
  for (const item of batch.prepared) {
    let state: SyncState;
    try {
      state = await readState(item.name, item.sourceContentHash, item.version);
    } catch (error) {
      changes.push({
        name: item.name,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const previous = state?.latest;
    const note = (status: string, reason: string, version?: string) =>
      changes.push({ name: item.name, status, reason, ...(version ? { version } : {}) });
    if (scheduled && !item.source.approved) {
      note("needs-review", "Source identity is not approved for scheduled synchronization");
      continue;
    }
    if (scheduled && !previous && item.source.approvedInitialHash !== item.sourceContentHash) {
      note("needs-review", "Initial source bytes differ from the reviewed batch");
      continue;
    }
    if (state?.deleted) {
      note("blocked", "Package was deleted; operator review is required");
      continue;
    }
    if (state && item.source.authorship === "company" && !state.staffCustody) {
      note("adopted", "The company owns this publisher; staff synchronization has stopped");
      continue;
    }
    if (
      previous &&
      (!previous.curation ||
        previous.source?.repo !== item.source.repo ||
        previous.source.path !== item.source.path ||
        previous.curation.repositoryId !== item.source.repositoryId ||
        previous.curation.ownerId !== item.source.ownerId ||
        previous.curation.integration !== item.source.integration ||
        previous.curation.job !== item.source.job ||
        previous.curation.format !== item.source.format ||
        previous.curation.authorship !== item.source.authorship)
    ) {
      note(
        "needs-review",
        "Published source identity differs; review a canonical source replacement",
      );
      continue;
    }
    if (previous?.status === "pending") {
      note(
        "pending",
        "The previous release is awaiting security checks or moderation",
        previous.version,
      );
      continue;
    }
    if (state?.matching && previous?.version !== state.matching.version) {
      note(
        "needs-review",
        "Upstream returned to historical content; review promotion of the existing release",
        state.matching.version,
      );
      continue;
    }
    if (state?.matching) {
      note(
        state.matching.status === "published" && state.matching.scanStatus === "clean"
          ? "unchanged"
          : "blocked",
        "These source bytes already have an immutable release",
        state.matching.version,
      );
      continue;
    }
    if (
      scheduled &&
      previous &&
      semver.valid(previous.version) &&
      semver.lt(item.version, previous.version)
    ) {
      note(
        "needs-review",
        "An upstream version downgrade requires reviewed promotion",
        item.version,
      );
      continue;
    }
    const parsed = semver.parse(item.version)!;
    const version = state?.requested
      ? `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length ? `-${parsed.prerelease.join(".")}` : ""}+${parsed.build.length ? `${parsed.build.join(".")}.` : ""}clawhub.${item.sourceContentHash.slice(0, 16)}`
      : item.version;
    if (version !== item.version) {
      try {
        const allocated = await readState(item.name, item.sourceContentHash, version);
        if (allocated?.requested?.version === version) {
          note("needs-review", "The generated immutable version is already occupied", version);
          continue;
        }
      } catch (error) {
        note("failed", error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    prepared.push({ ...item, version });
    note(
      previous ? "update" : "initial",
      previous
        ? "Changed source bytes require a new scanned immutable release"
        : "New curated source requires initial batch review",
      version,
    );
  }
  return { ...batch, prepared, ...buildImportPlan(prepared), changes };
}

export async function readSyncState(
  registry: string,
  token: string,
  name: string,
  hash: string,
  version: string,
): Promise<SyncState> {
  const url = new URL(`/api/v1/packages/${encodeURIComponent(name)}/sync-state`, registry);
  url.searchParams.set("sourceHash", hash);
  url.searchParams.set("version", version);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Synchronization state request failed: HTTP ${response.status}`);
  const state = await response.json();
  if (
    state !== null &&
    (typeof state !== "object" ||
      typeof state.deleted !== "boolean" ||
      typeof state.staffCustody !== "boolean")
  )
    throw new Error("Invalid synchronization state response");
  return state;
}

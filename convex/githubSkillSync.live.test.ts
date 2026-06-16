/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  applyGitHubSkillSourceSyncHandler,
  applyGitHubSkillVerificationResultHandler,
  configurePublicGitHubSkillSourceHandler,
  upsertGitHubSkillContentHandler,
  verifyGitHubSkillHandler,
} from "./githubSkillSync";
import { buildSkillInstallResolution } from "./lib/installResolver";
import {
  appendGitHubSkillScanRequestFilesInternal,
  finalizeGitHubSkillScanRequestInternal,
  prepareGitHubSkillScanRequestInternal,
} from "./securityScan";

type Row = Record<string, unknown> & { _id: string };

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Row, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([table, rows]) => [table, [...rows]]),
  );
  const counters: Record<string, number> = {};
  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const db = {
    get: async (idOrTable: string, maybeId?: string) => {
      const id = maybeId ?? idOrTable;
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    normalizeId: (table: string, id: string) => (id.startsWith(`${table}:`) ? id : null),
    insert: async (table: string, doc: Record<string, unknown>) => {
      counters[table] = (counters[table] ?? 0) + 1;
      const inserted = {
        _id: `${table}:new-${counters[table]}`,
        _creationTime: counters[table],
        ...doc,
      };
      list(table).push(inserted);
      return inserted._id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const row = list(table).find((candidate) => candidate._id === id);
      if (!row) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    replace: async (id: string, doc: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((candidate) => candidate._id === id);
      if (index >= 0) rows[index] = { _id: id, ...doc };
    },
    delete: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      const rows = list(table);
      const index = rows.findIndex((candidate) => candidate._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    query: (table: string) => ({
      withIndex: (_indexName: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build?.(chainEq(constraints));
        const matched = () => list(table).filter((row) => matches(row, constraints));
        return {
          collect: async () => matched(),
          take: async (limit: number) => matched().slice(0, limit),
          unique: async () => matched()[0] ?? null,
        };
      },
    }),
  };

  return { db, tables };
}

function getSkill(tables: Record<string, Row[]>, slug: string) {
  const skill = tables.skills?.find((row) => row.slug === slug);
  if (!skill) throw new Error(`Live GitHub canary did not discover skill: ${slug}`);
  return skill;
}

function resolveInstallFromTables(tables: Record<string, Row[]>, slug: string) {
  const skill = getSkill(tables, slug);
  const source =
    typeof skill.githubSourceId === "string"
      ? (tables.githubSkillSources?.find((row) => row._id === skill.githubSourceId) ?? null)
      : null;
  return buildSkillInstallResolution({
    origin: "https://clawhub.ai",
    skill: skill as never,
    source: source as never,
  });
}

const liveCanaryEnabled = process.env.CLAWHUB_LIVE_GITHUB_CANARY === "1";
const itIfLive = liveCanaryEnabled ? it : it.skip;

describe("GitHub-backed skills live canary", () => {
  itIfLive(
    "discovers and verifies an installable skill from a real GitHub repo",
    { timeout: 45_000 },
    async () => {
      const repo = process.env.CLAWHUB_LIVE_GITHUB_REPO?.trim() || "openclaw/agent-skills";
      const skillSlug = process.env.CLAWHUB_LIVE_GITHUB_SKILL?.trim() || "handoff";
      const { db, tables } = createDb({
        globalStats: [
          {
            _id: "globalStats:default",
            key: "default",
            activeSkillsCount: 0,
            updatedAt: 1,
          },
        ],
      });
      const scheduler = { runAfter: async () => undefined };
      let storedFile = 0;
      let now = Date.now();
      const actionCtx = {
        runQuery: async (_query: unknown, args: Record<string, unknown>) => {
          if ("ownerPublisherId" in args && "actorUserId" in args) {
            return {
              ownerUserId: "users:live-owner",
              existingSource:
                tables.githubSkillSources?.find((source) => source.repo === repo) ?? null,
              official: true,
            };
          }
          if ("skillId" in args) {
            const skill = tables.skills?.find((row) => row._id === args.skillId);
            const source =
              skill && typeof skill.githubSourceId === "string"
                ? tables.githubSkillSources?.find((row) => row._id === skill.githubSourceId)
                : null;
            return skill && source ? { skill, source } : null;
          }
          if ("sourceId" in args) {
            return (tables.skills ?? []).flatMap((skill) => {
              if (
                skill.githubSourceId !== args.sourceId ||
                skill.installKind !== "github" ||
                skill.githubCurrentStatus !== "present" ||
                typeof skill.githubPath !== "string" ||
                typeof skill.githubCurrentContentHash !== "string"
              ) {
                return [];
              }
              return [
                {
                  skillId: skill._id,
                  githubPath: skill.githubPath,
                  githubCurrentContentHash: skill.githubCurrentContentHash,
                },
              ];
            });
          }
          throw new Error(`unexpected live canary query args: ${JSON.stringify(args)}`);
        },
        runMutation: async (_mutation: unknown, args: Record<string, unknown>) => {
          if ("snapshot" in args) {
            return await applyGitHubSkillSourceSyncHandler(
              { db, scheduler } as never,
              {
                ...args,
                now,
              } as never,
            );
          }
          if ("requestId" in args && "files" in args) {
            return await (
              appendGitHubSkillScanRequestFilesInternal as unknown as {
                _handler: (ctx: never, args: never) => unknown;
              }
            )._handler({ db } as never, args as never);
          }
          if ("requestId" in args) {
            return await (
              finalizeGitHubSkillScanRequestInternal as unknown as {
                _handler: (ctx: never, args: never) => unknown;
              }
            )._handler({ db } as never, args as never);
          }
          if ("staticScan" in args && "commit" in args && "contentHash" in args) {
            return await (
              prepareGitHubSkillScanRequestInternal as unknown as {
                _handler: (ctx: never, args: never) => unknown;
              }
            )._handler({ db } as never, args as never);
          }
          if ("scanStatus" in args && "contentHash" in args) {
            return await applyGitHubSkillVerificationResultHandler(
              { db } as never,
              {
                ...args,
                now,
              } as never,
            );
          }
          if ("discovered" in args && "commit" in args) {
            return await upsertGitHubSkillContentHandler(
              { db } as never,
              {
                ...args,
                now,
              } as never,
            );
          }
          throw new Error(`unexpected live canary mutation args: ${JSON.stringify(args)}`);
        },
        storage: {
          store: async () => {
            storedFile += 1;
            return `storage:live-${storedFile}`;
          },
          delete: async () => undefined,
        },
        auth: { getUserIdentity: async () => null },
      };

      const configured = await configurePublicGitHubSkillSourceHandler(
        actionCtx as never,
        {
          ownerPublisherId: "publishers:live" as never,
          repo,
        },
        fetch,
        { userId: "users:live-owner" as never },
      );

      expect(configured.stats.discovered).toBeGreaterThan(0);
      expect(configured.manifestStatus === "missing" || configured.manifestStatus === "ok").toBe(
        true,
      );
      expect(configured.commit).toMatch(/^[a-f0-9]{40}$/);

      let skill = getSkill(tables, skillSlug);
      expect(skill).toMatchObject({
        installKind: "github",
        githubPath: `skills/${skillSlug}`,
        githubCurrentCommit: configured.commit,
        githubCurrentStatus: "present",
        githubScanStatus: "pending",
      });
      expect(resolveInstallFromTables(tables, skillSlug)).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
      });

      now = Date.now();
      const verified = await verifyGitHubSkillHandler(
        actionCtx as never,
        {
          skillId: skill._id as never,
          contentHash: skill.githubCurrentContentHash as string,
        },
        fetch,
      );

      expect(verified).toMatchObject({ ok: true, queued: true });
      expect(storedFile).toBeGreaterThan(0);
      expect(resolveInstallFromTables(tables, skillSlug)).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
      });
      await applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: skill._id as never,
        contentHash: skill.githubCurrentContentHash as string,
        scanStatus: "clean",
        now,
      });
      skill = getSkill(tables, skillSlug);
      expect(skill).toMatchObject({
        githubCurrentCommit: configured.commit,
        githubScanStatus: "clean",
        moderationStatus: "active",
      });
      expect(resolveInstallFromTables(tables, skillSlug)).toMatchObject({
        ok: true,
        installKind: "github",
        github: {
          repo,
          path: `skills/${skillSlug}`,
          commit: configured.commit,
          contentHash: skill.githubCurrentContentHash,
        },
      });
    },
  );
});

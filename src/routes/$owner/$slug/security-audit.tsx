import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  SecurityAuditPage,
  SecurityAuditPageSkeleton,
} from "../../../components/SecurityAuditPage";
import {
  buildSkillDetailHref,
  buildSkillSecurityAuditHref,
  isOwnerRouteHandleOrIdSegment,
} from "../../../lib/ownerRoute";
import { isModerator } from "../../../lib/roles";
import {
  buildSkillRouteMeta,
  createSkillRouteLoader,
  type SkillRouteHeadArgs,
} from "../../../lib/skillRoute";
import { useAuthStatus } from "../../../lib/useAuthStatus";

export const Route = createFileRoute("/$owner/$slug/security-audit")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
    throw redirect({
      href: buildSkillSecurityAuditHref(params.owner, params.slug),
      replace: true,
    });
  },
});

export const loadSkillSecurityAuditRouteData = createSkillRouteLoader(
  "/$owner/skills/$slug/security-audit",
);

export function skillSecurityAuditRouteHead({ params, loaderData }: SkillRouteHeadArgs) {
  const meta = buildSkillRouteMeta({ params, loaderData });
  return {
    meta: [
      { title: `Security audit · ${meta.title}` },
      {
        name: "description",
        content: `Security audit details for ${loaderData?.displayName ?? params.slug}.`,
      },
    ],
  };
}

export function SkillSecurityAuditRoutePage({
  owner,
  slug,
  initialData,
}: {
  owner: string;
  slug: string;
  initialData: Awaited<ReturnType<typeof loadSkillSecurityAuditRouteData>>["initialData"];
}) {
  const liveLookupOwnerHandle =
    initialData && "lookupOwnerHandle" in initialData ? initialData.lookupOwnerHandle : owner;
  const liveResult = useQuery(
    api.skills.getBySlug,
    liveLookupOwnerHandle ? { slug, ownerHandle: liveLookupOwnerHandle } : { slug },
  );
  const requestSkillRescan = useMutation(api.securityScan.requestSkillRescan);
  const { me } = useAuthStatus();
  const myPublishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{ publisher: { _id: string }; role: string }>
    | undefined;
  const result = liveResult === undefined ? initialData?.result : liveResult;
  const skill = result?.skill;
  const latestVersion = result?.latestVersion;
  const githubScan = useQuery(
    api.skills.getGitHubScanForAudit,
    skill?.installKind === "github" ? { slug } : "skip",
  );
  const audit = latestVersion ?? githubScan;

  if (result === undefined || (skill?.installKind === "github" && githubScan === undefined)) {
    return <SecurityAuditPageSkeleton />;
  }

  if (!skill || !audit) {
    return (
      <main className="section">
        <div className="card">Security audit is unavailable for this skill.</div>
      </main>
    );
  }

  const ownerSegment = result?.owner?.handle ?? result?.owner?._id ?? owner;
  const myManagePublisherIds = new Set(
    (Array.isArray(myPublishers) ? myPublishers : [])
      .filter((entry) => entry.role === "owner" || entry.role === "admin")
      .map((entry) => entry.publisher._id),
  );
  const canManageArtifact =
    Boolean(me && skill && me._id === skill.ownerUserId) ||
    Boolean(skill?.ownerPublisherId && myManagePublisherIds.has(skill.ownerPublisherId)) ||
    isModerator(me);

  return (
    <SecurityAuditPage
      entity={{
        kind: "skill",
        title: skill.displayName,
        name: slug,
        version: audit.version,
        owner: result?.owner ?? null,
        ownerUserId: skill.ownerUserId,
        ownerPublisherId: skill.ownerPublisherId ?? null,
        detailPath: buildSkillDetailHref(ownerSegment, slug),
      }}
      sha256hash={latestVersion?.sha256hash ?? null}
      aigAnalysis={audit.aigAnalysis ?? null}
      llmAnalysis={audit.llmAnalysis ?? null}
      skillSpectorAnalysis={audit.skillSpectorAnalysis ?? null}
      canManageArtifact={canManageArtifact}
      onRequestRescan={
        canManageArtifact
          ? () =>
              requestSkillRescan({
                skillId: skill._id,
                ...(latestVersion ? { version: latestVersion.version } : {}),
              })
          : null
      }
    />
  );
}

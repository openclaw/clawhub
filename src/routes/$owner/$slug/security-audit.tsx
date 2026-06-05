import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  SecurityAuditPage,
  SecurityAuditPageSkeleton,
} from "../../../components/SecurityAuditPage";
import { buildSkillMeta } from "../../../lib/og";
import { isModerator } from "../../../lib/roles";
import { fetchSkillPageData } from "../../../lib/skillPage";
import { useAuthStatus } from "../../../lib/useAuthStatus";

export const Route = createFileRoute("/$owner/$slug/security-audit")({
  beforeLoad: ({ params }) => {
    const isHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isOwnerId = params.owner.startsWith("users:") || params.owner.startsWith("publishers:");
    if (!isHandle && !isOwnerId) throw notFound();
  },
  loader: async ({ params }) => {
    const data = await fetchSkillPageData(params.slug);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: "/$owner/$slug/security-audit",
        params: {
          owner: canonicalOwner,
          slug: canonicalSlug,
        },
        replace: true,
      });
    }

    return {
      owner: data?.owner ?? params.owner,
      displayName: data?.displayName ?? null,
      summary: data?.summary ?? null,
      version: data?.version ?? null,
      initialData: data.initialData,
    };
  },
  head: ({ params, loaderData }) => {
    const meta = buildSkillMeta({
      slug: params.slug,
      owner: loaderData?.owner ?? params.owner,
      displayName: loaderData?.displayName,
      summary: loaderData?.summary,
      version: loaderData?.version ?? null,
    });
    return {
      meta: [
        { title: `Security audit · ${meta.title}` },
        {
          name: "description",
          content: `Security audit details for ${loaderData?.displayName ?? params.slug}.`,
        },
      ],
    };
  },
  component: SkillSecurityAuditRoute,
});

function SkillSecurityAuditRoute() {
  const { owner, slug } = Route.useParams();
  const { initialData } = Route.useLoaderData();
  const liveResult = useQuery(api.skills.getBySlug, { slug });
  const requestSkillRescan = useMutation(api.securityScan.requestSkillRescan);
  const { me } = useAuthStatus();
  const myPublishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{ publisher: { _id: string }; role: string }>
    | undefined;
  const result = liveResult === undefined ? initialData?.result : liveResult;
  const skill = result?.skill;
  const latestVersion = result?.latestVersion;

  if (result === undefined) {
    return <SecurityAuditPageSkeleton />;
  }

  if (!skill || !latestVersion) {
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
        version: latestVersion.version,
        owner: result?.owner ?? null,
        ownerUserId: skill.ownerUserId,
        ownerPublisherId: skill.ownerPublisherId ?? null,
        detailPath: `/${encodeURIComponent(ownerSegment)}/${encodeURIComponent(slug)}`,
      }}
      sha256hash={latestVersion.sha256hash ?? null}
      vtAnalysis={latestVersion.vtAnalysis ?? null}
      llmAnalysis={latestVersion.llmAnalysis ?? null}
      skillSpectorAnalysis={latestVersion.skillSpectorAnalysis ?? null}
      staticScan={latestVersion.staticScan ?? null}
      canManageArtifact={canManageArtifact}
      onRequestRescan={
        canManageArtifact
          ? () => requestSkillRescan({ skillId: skill._id, version: latestVersion.version })
          : null
      }
    />
  );
}

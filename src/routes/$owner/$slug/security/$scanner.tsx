import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  SecurityScannerPage,
  SecurityScannerPageSkeleton,
  type ScannerSlug,
} from "../../../../components/SecurityScannerPage";
import { getClawScanHashScrollScripts } from "../../../../lib/clawScanHashScroll";
import { buildSkillMeta } from "../../../../lib/og";
import { isAdmin } from "../../../../lib/roles";
import { fetchSkillPageData } from "../../../../lib/skillPage";
import { useAuthStatus } from "../../../../lib/useAuthStatus";

const SCANNERS = new Set<ScannerSlug>(["virustotal", "clawscan", "static-analysis"]);

function parseScanner(scanner: string): ScannerSlug {
  if (SCANNERS.has(scanner as ScannerSlug)) return scanner as ScannerSlug;
  throw notFound();
}

export const Route = createFileRoute("/$owner/$slug/security/$scanner")({
  beforeLoad: ({ params }) => {
    const isHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isOwnerId = params.owner.startsWith("users:") || params.owner.startsWith("publishers:");
    if (!isHandle && !isOwnerId) {
      throw notFound();
    }
    if (params.scanner === "openclaw") {
      throw redirect({
        to: "/$owner/$slug/security/$scanner",
        params: { owner: params.owner, slug: params.slug, scanner: "clawscan" },
        replace: true,
      });
    }
    parseScanner(params.scanner);
  },
  loader: async ({ params }) => {
    const data = await fetchSkillPageData(params.slug);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: "/$owner/$slug/security/$scanner",
        params: {
          owner: canonicalOwner,
          slug: canonicalSlug,
          scanner: params.scanner === "openclaw" ? "clawscan" : params.scanner,
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
  scripts: ({ params }) => getClawScanHashScrollScripts(params.scanner),
  head: ({ params, loaderData }) => {
    const scanner = parseScanner(params.scanner);
    const scannerLabel =
      scanner === "virustotal"
        ? "VirusTotal"
        : scanner === "clawscan"
          ? "ClawScan"
          : "Static analysis";
    const meta = buildSkillMeta({
      slug: params.slug,
      owner: loaderData?.owner ?? params.owner,
      displayName: loaderData?.displayName,
      summary: loaderData?.summary,
      version: loaderData?.version ?? null,
    });
    return {
      meta: [
        { title: `${scannerLabel} security · ${meta.title}` },
        {
          name: "description",
          content: `${scannerLabel} security details for ${loaderData?.displayName ?? params.slug}.`,
        },
      ],
    };
  },
  component: SkillSecurityScannerRoute,
});

function SkillSecurityScannerRoute() {
  const { owner, slug, scanner } = Route.useParams();
  const { initialData } = Route.useLoaderData();
  const liveResult = useQuery(api.skills.getBySlug, { slug });
  const { me } = useAuthStatus();
  const myPublishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{ publisher: { _id: string }; role: string }>
    | undefined;
  const result = liveResult === undefined ? initialData?.result : liveResult;
  const skill = result?.skill;
  const latestVersion = result?.latestVersion;

  if (result === undefined) {
    return <SecurityScannerPageSkeleton />;
  }

  if (!skill || !latestVersion) {
    return (
      <main className="section">
        <div className="card">Security details are unavailable for this skill.</div>
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
    isAdmin(me);
  const settingsHref = `/${encodeURIComponent(ownerSegment)}/${encodeURIComponent(slug)}/settings`;

  return (
    <SecurityScannerPage
      scanner={parseScanner(scanner)}
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
      staticScan={latestVersion.staticScan ?? null}
      clawScanNote={latestVersion.clawScanNote ?? null}
      canManageArtifact={canManageArtifact}
      settingsHref={canManageArtifact ? settingsHref : null}
    />
  );
}

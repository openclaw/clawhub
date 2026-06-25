import {
  createFileRoute,
  notFound,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SkillDetailPage } from "../../components/SkillDetailPage";
import { buildSkillMeta } from "../../lib/og";
import {
  buildSkillDetailHref,
  isOwnerRouteHandleOrIdSegment,
  isOwnerRouteScopeSegment,
} from "../../lib/ownerRoute";
import { consumePostPublishFlash } from "../../lib/postPublishFlash";
import { fetchSkillPageData } from "../../lib/skillPage";
import { resolveOpenClawPluginSlug } from "../../lib/slugRoute";

function isPostPublishFlag(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : value;
  return normalized === "1" || normalized === "true" || normalized === 1 || normalized === true;
}

function hasPostPublishSearch(searchStr: string) {
  return isPostPublishFlag(new URLSearchParams(searchStr).get("published"));
}

export const Route = createFileRoute("/$owner/$slug")({
  validateSearch: (search) => {
    const parsed: { published?: true } = {};
    if (isPostPublishFlag(search.published)) {
      parsed.published = true;
    }
    return parsed;
  },
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner) && !isOwnerRouteScopeSegment(params.owner)) {
      throw notFound();
    }
  },
  loader: async ({ params }) => {
    const pluginTarget = await resolveOpenClawPluginSlug(params.slug, params.owner);
    if (pluginTarget) {
      throw redirect({
        href: pluginTarget.href,
        replace: true,
      });
    }

    if (params.owner.startsWith("@")) throw notFound();

    throw redirect({
      href: buildSkillDetailHref(params.owner, params.slug),
      replace: true,
    });
  },
});

export async function loadSkillDetailRouteData(params: { owner: string; slug: string }) {
  const data = await fetchSkillPageData(params.slug, params.owner);
  const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
  const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

  if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
    throw redirect({
      to: "/$owner/skills/$slug",
      params: { owner: canonicalOwner, slug: canonicalSlug },
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
}

export function skillDetailRouteHead({
  params,
  loaderData,
}: {
  params: { owner: string; slug: string };
  loaderData?: {
    owner?: string | null;
    displayName?: string | null;
    summary?: string | null;
    version?: string | null;
  };
}) {
  const meta = buildSkillMeta({
    slug: params.slug,
    owner: loaderData?.owner ?? params.owner,
    displayName: loaderData?.displayName,
    summary: loaderData?.summary,
    version: loaderData?.version ?? null,
  });
  return {
    links: [
      {
        rel: "canonical",
        href: meta.url,
      },
    ],
    meta: [
      { title: meta.title },
      { name: "description", content: meta.description },
      { property: "og:title", content: meta.title },
      { property: "og:description", content: meta.description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: meta.url },
      { property: "og:image", content: meta.image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: meta.title },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: meta.title },
      { name: "twitter:description", content: meta.description },
      { name: "twitter:image", content: meta.image },
      { name: "twitter:image:alt", content: meta.title },
    ],
  };
}

export function SkillDetailRoutePage({
  owner,
  slug,
  published,
  initialData,
}: {
  owner: string;
  slug: string;
  published?: true;
  initialData: Awaited<ReturnType<typeof loadSkillDetailRouteData>>["initialData"];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const hasPublishedSearch = isPostPublishFlag(published) || hasPostPublishSearch(searchStr);
  const [showPostPublishSuccess, setShowPostPublishSuccess] = useState(() =>
    hasPublishedSearch ? true : consumePostPublishFlash(owner, slug),
  );

  useEffect(() => {
    const hasFlash = consumePostPublishFlash(owner, slug);
    if (hasPublishedSearch || hasFlash) {
      setShowPostPublishSuccess(true);
    }
    if (hasPublishedSearch) {
      void navigate({
        to: "/$owner/skills/$slug",
        params: { owner, slug },
        search: {},
        replace: true,
      });
    }
  }, [hasPublishedSearch, navigate, owner, slug]);

  if (
    pathname.includes(`/${encodeURIComponent(slug)}/security/`) ||
    pathname.endsWith(`/${encodeURIComponent(slug)}/security-audit`) ||
    pathname.endsWith(`/${encodeURIComponent(slug)}/settings`)
  ) {
    return <Outlet />;
  }
  return (
    <SkillDetailPage
      slug={slug}
      canonicalOwner={owner}
      initialData={initialData}
      showPostPublishSuccess={showPostPublishSuccess}
      onDismissPostPublish={() => {
        setShowPostPublishSuccess(false);
        void navigate({
          to: "/$owner/skills/$slug",
          params: { owner, slug },
          search: {},
          replace: true,
        });
      }}
    />
  );
}

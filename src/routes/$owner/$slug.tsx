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
import {
  buildSkillDetailHref,
  isOwnerRouteHandleOrIdSegment,
  isOwnerRouteScopeSegment,
} from "../../lib/ownerRoute";
import { consumePostPublishFlash } from "../../lib/postPublishFlash";
import {
  hasPostPublishSearch,
  isPostPublishFlag,
  parsePostPublishSearch,
} from "../../lib/postPublishSearch";
import {
  buildSkillRouteMeta,
  createSkillRouteLoader,
  type SkillRouteHeadArgs,
} from "../../lib/skillRoute";
import { resolveOpenClawPluginSlug } from "../../lib/slugRoute";

export const Route = createFileRoute("/$owner/$slug")({
  validateSearch: parsePostPublishSearch,
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

export const loadSkillDetailRouteData = createSkillRouteLoader("/$owner/skills/$slug");

export function skillDetailRouteHead({ params, loaderData }: SkillRouteHeadArgs) {
  const meta = buildSkillRouteMeta({ params, loaderData });
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

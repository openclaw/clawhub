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
    const isHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isScope = /^@[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isOwnerId = params.owner.startsWith("users:") || params.owner.startsWith("publishers:");
    if (!isHandle && !isScope && !isOwnerId) {
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

    const data = await fetchSkillPageData(params.slug);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: "/$owner/$slug",
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
  },
  component: OwnerSkill,
});

function OwnerSkill() {
  const { owner, slug } = Route.useParams();
  const search = Route.useSearch();
  const { initialData } = Route.useLoaderData();
  const navigate = useNavigate({ from: "/$owner/$slug" });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const hasPublishedSearch = isPostPublishFlag(search.published) || hasPostPublishSearch(searchStr);
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
        to: "/$owner/$slug",
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
          to: "/$owner/$slug",
          params: { owner, slug },
          search: {},
          replace: true,
        });
      }}
    />
  );
}

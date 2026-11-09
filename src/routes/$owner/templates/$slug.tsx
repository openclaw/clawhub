import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { Container } from "../../../components/layout/Container";
import { TemplateDetailPage } from "../../../components/TemplateDetailPage";
import {
  fetchPackageDetail,
  fetchPackageFile,
  type PackageDetailResponse,
} from "../../../lib/packageApi";
import { getClawHubSiteUrl } from "../../../lib/site";
import { getTemplateManifestPath } from "../../../lib/templateDetail";
import {
  buildTemplateDetailHref,
  normalizePublisherHandle,
  packageNameFromPublisherTemplateRoute,
} from "../../../lib/templateRoutes";

type TemplateDetailData = {
  detail: PackageDetailResponse;
  contents: string | null;
};

function packageNameFromParams(params: { owner: string; slug: string }) {
  const name = packageNameFromPublisherTemplateRoute(params.owner, params.slug);
  if (!name) throw notFound();
  return name;
}

export async function loadPublisherTemplate(params: {
  owner: string;
  slug: string;
}): Promise<TemplateDetailData> {
  const requestedName = packageNameFromParams(params);
  const requestedOwner = normalizePublisherHandle(params.owner);
  let detail = await fetchPackageDetail(requestedName);
  if (!detail.package) {
    const unscoped = await fetchPackageDetail(params.slug);
    if (unscoped.package && normalizePublisherHandle(unscoped.owner?.handle) === requestedOwner) {
      detail = unscoped;
    }
  }
  if (
    !detail.package ||
    detail.package.family !== "template" ||
    normalizePublisherHandle(detail.owner?.handle) !== requestedOwner
  ) {
    throw notFound();
  }
  let contents: string | null = null;
  if (detail.package.latestVersion) {
    const [rootContents, packageJson] = await Promise.all([
      fetchPackageFile(detail.package.name, "CLAW.md", detail.package.latestVersion),
      fetchPackageFile(detail.package.name, "package.json", detail.package.latestVersion),
    ]);
    const manifestPath = getTemplateManifestPath(packageJson);
    contents =
      manifestPath === "CLAW.md"
        ? rootContents
        : await fetchPackageFile(detail.package.name, manifestPath, detail.package.latestVersion);
  }
  return { detail, contents };
}

export const Route = createFileRoute("/$owner/templates/$slug")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params }) => {
    const data = await loadPublisherTemplate(params);
    const pkg = data.detail.package!;
    const canonicalHref = buildTemplateDetailHref(pkg.name, data.detail.owner?.handle);
    const requestedHref = buildTemplateDetailHref(packageNameFromParams(params), params.owner);
    if (canonicalHref && canonicalHref !== requestedHref) {
      throw redirect({ href: canonicalHref, replace: true });
    }
    return data;
  },
  head: ({ params, loaderData }) => {
    const pkg = loaderData?.detail.package;
    const owner = loaderData?.detail.owner?.handle ?? params.owner;
    const canonicalPath = buildTemplateDetailHref(
      pkg?.name ?? packageNameFromParams(params),
      owner,
    );
    const canonicalUrl = canonicalPath
      ? `${getClawHubSiteUrl()}${canonicalPath}`
      : getClawHubSiteUrl();
    const title = `${pkg?.displayName ?? params.slug} — ClawHub Templates`;
    const description =
      pkg?.summary ?? pkg?.templateManifestSummary?.agent.description ?? "OpenClaw Template";
    return {
      links: [{ rel: "canonical", href: canonicalUrl }],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  pendingComponent: TemplateDetailPending,
  errorComponent: TemplateDetailError,
  component: PublisherTemplatePage,
});

function TemplateDetailPending() {
  return (
    <main className="section detail-page-section" aria-busy="true">
      <Container size="narrow">
        <div role="status" className="py-12 text-center text-ink-soft">
          Loading Template details…
        </div>
      </Container>
    </main>
  );
}

function TemplateDetailError() {
  const router = useRouter();
  return (
    <main className="template-detail-page">
      <Container size="narrow">
        <div role="alert" className="space-y-3 py-12 text-center">
          <h1 className="text-xl font-semibold">Could not load this Template</h1>
          <p className="text-ink-soft">
            The registry could not return the Template details. Please try again.
          </p>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => void router.invalidate()}
          >
            Try again
          </button>
        </div>
      </Container>
    </main>
  );
}

function PublisherTemplatePage() {
  const params = Route.useParams();
  const { detail, contents } = Route.useLoaderData() as TemplateDetailData;
  return (
    <TemplateDetailPage
      key={detail.package!.name + ":" + detail.package!.latestVersion}
      detail={detail}
      contents={contents}
      fallbackOwner={params.owner}
    />
  );
}

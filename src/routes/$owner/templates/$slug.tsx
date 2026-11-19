import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/react-router";
import { Container } from "../../../components/layout/Container";
import { TemplateDetailSkeleton } from "../../../components/skeletons/TemplateDetailSkeleton";
import { TemplateDetailPage } from "../../../components/TemplateDetailPage";
import {
  fetchPackageFile,
  fetchPackageVersion,
  type PackageVersionDetail,
  type PackageDetailResponse,
} from "../../../lib/packageApi";
import { getClawHubSiteUrl } from "../../../lib/site";
import { getTemplateManifestPath } from "../../../lib/templateDetail";
import { loadTemplatePackage } from "../../../lib/templatePackage";
import {
  buildTemplateDetailHref,
  packageNameFromPublisherTemplateRoute,
} from "../../../lib/templateRoutes";

type TemplateDetailData = {
  detail: PackageDetailResponse;
  contents: string | null;
  llmAnalysis: NonNullable<PackageVersionDetail["version"]>["llmAnalysis"] | null;
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
  const { templateRelease, ...detail } = await loadTemplatePackage(params, "template-detail");
  // Treat an authoritative null preview as unavailable, not a trigger to read other files.
  if (
    templateRelease &&
    templateRelease.version === detail.package.latestVersion &&
    detail.package.channel !== "private" &&
    detail.package.scanStatus !== "malicious"
  ) {
    return {
      detail,
      contents: templateRelease.contents,
      llmAnalysis: templateRelease.llmAnalysis ?? null,
    };
  }
  // Private/held releases retain their original viewer-authorized file and audit reads,
  // as do older registries which return only ordinary package metadata.
  let contents: string | null = null;
  let llmAnalysis: TemplateDetailData["llmAnalysis"] = null;
  if (detail.package.latestVersion) {
    const [rootContents, packageJson, release] = await Promise.all([
      fetchPackageFile(detail.package.name, "CLAW.md", detail.package.latestVersion),
      fetchPackageFile(detail.package.name, "package.json", detail.package.latestVersion),
      fetchPackageVersion(detail.package.name, detail.package.latestVersion),
    ]);
    if (release?.version?.version === detail.package.latestVersion) {
      llmAnalysis = release.version.llmAnalysis ?? null;
    }
    const manifestPath = getTemplateManifestPath(packageJson);
    contents =
      manifestPath === "CLAW.md"
        ? rootContents
        : await fetchPackageFile(detail.package.name, manifestPath, detail.package.latestVersion);
  }
  return { detail, contents, llmAnalysis };
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
  pendingMs: 100,
  pendingMinMs: 0,
  pendingComponent: TemplateDetailSkeleton,
  errorComponent: TemplateDetailError,
  component: PublisherTemplatePage,
});

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
  const { detail, contents, llmAnalysis } = Route.useLoaderData() as TemplateDetailData;
  return (
    <TemplateDetailPage
      key={detail.package!.name + ":" + detail.package!.latestVersion}
      detail={detail}
      contents={contents}
      llmAnalysis={llmAnalysis}
      fallbackOwner={params.owner}
    />
  );
}

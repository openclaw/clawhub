import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Bot, Boxes, CalendarClock, Plug, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { DetailBody, DetailHero, DetailPageShell } from "../../../components/DetailPageShell";
import { EmptyState } from "../../../components/EmptyState";
import { Container } from "../../../components/layout/Container";
import { MarkdownPreview } from "../../../components/MarkdownPreview";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { UserBadge } from "../../../components/UserBadge";
import { buildPublisherProfileHref } from "../../../lib/ownerRoute";
import {
  fetchPackageDetail,
  fetchPackageFile,
  type PackageDetailResponse,
} from "../../../lib/packageApi";
import { getClawHubSiteUrl } from "../../../lib/site";
import {
  buildTemplateDetailHref,
  templateSecurityStatusMessage,
  isTemplateReadyToAdd,
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
  const contents = detail.package.latestVersion
    ? await fetchPackageFile(detail.package.name, "CLAW.md", detail.package.latestVersion)
    : null;
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

function PublisherTemplatePage() {
  const params = Route.useParams();
  const { detail, contents } = Route.useLoaderData() as TemplateDetailData;
  const pkg = detail.package!;
  const summary = pkg.templateManifestSummary;
  const description = pkg.summary ?? summary?.agent.description ?? "";
  const owner = detail.owner;
  const scanStatus = pkg.scanStatus ?? "pending";
  const readyToAdd = isTemplateReadyToAdd(scanStatus);
  const stats = [
    { label: "Workspace files", value: summary?.workspace.fileCount ?? 0, icon: Boxes },
    { label: "Skills", value: summary?.packages.skillCount ?? 0, icon: Sparkles },
    { label: "Plugins", value: summary?.packages.pluginCount ?? 0, icon: Plug },
    { label: "Scheduled jobs", value: summary?.cronJobCount ?? 0, icon: CalendarClock },
  ];

  return (
    <main className="section detail-page-section template-detail-page">
      <Container size="wide">
        <DetailPageShell>
          <DetailHero
            main={
              <div className="skill-hero-title">
                <nav className="skill-hero-breadcrumbs" aria-label="Template breadcrumbs">
                  <span>Templates</span>
                  <span aria-hidden="true">/</span>
                  {owner?.handle ? (
                    <a href={buildPublisherProfileHref(owner.handle)}>@{owner.handle}</a>
                  ) : (
                    <span>@{params.owner}</span>
                  )}
                </nav>
                <div className="skill-hero-heading-stack">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="skill-hero-heading">
                      {summary?.agent.name || pkg.displayName || params.slug}
                    </h1>
                    <Badge>Template</Badge>
                  </div>
                  {description ? <p className="skill-hero-summary">{description}</p> : null}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3">
                    <UserBadge user={owner} fallbackHandle={params.owner} prefix="by" />
                    <span className="text-sm text-ink-soft">
                      Version {pkg.latestVersion ?? "—"}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 text-sm text-ink-soft"
                      data-scan-status={scanStatus}
                      role={
                        scanStatus === "suspicious" || scanStatus === "malicious"
                          ? "alert"
                          : undefined
                      }
                    >
                      {scanStatus === "clean" ? (
                        <ShieldCheck size={15} aria-hidden="true" />
                      ) : (
                        <ShieldAlert size={15} aria-hidden="true" />
                      )}
                      {templateSecurityStatusMessage(scanStatus)}
                    </span>
                  </div>
                </div>
              </div>
            }
            sidebar={
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot size={18} aria-hidden="true" />{" "}
                    {readyToAdd ? "Add this Template" : "Security status"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-ink-soft">
                  <p>
                    {readyToAdd
                      ? "Find this Template in OpenClaw’s Templates catalog and add it as a new agent."
                      : templateSecurityStatusMessage(scanStatus)}
                  </p>
                  {readyToAdd ? (
                    <Button asChild variant="outline" className="w-full">
                      <a href="https://docs.openclaw.ai/cli/agents">
                        How Templates work in OpenClaw
                      </a>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <Icon size={18} className="text-ink-soft" aria-hidden="true" />
                    <div>
                      <div className="font-semibold text-ink">{value}</div>
                      <div className="text-xs text-ink-soft">{label}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DetailHero>
          <DetailBody>
            {contents ? (
              <Card>
                <CardHeader>
                  <CardTitle>About this Template</CardTitle>
                </CardHeader>
                <CardContent>
                  <MarkdownPreview>{contents}</MarkdownPreview>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                title="Template instructions are unavailable"
                description="The publisher has not provided readable instructions for this release."
              />
            )}
          </DetailBody>
        </DetailPageShell>
      </Container>
    </main>
  );
}

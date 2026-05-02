import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileJson, Fingerprint, ShieldCheck, Terminal } from "lucide-react";
import { InstallCopyButton } from "../../../../components/InstallCopyButton";
import { Container } from "../../../../components/layout/Container";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import {
  fetchPackageDetail,
  fetchPackageClawPack,
  fetchPackageClawPackManifest,
  getPackageDownloadPath,
  getPackageClawPackPath,
  isRateLimitedPackageApiError,
  type PackageDetailResponse,
  type PackageClawPackManifestDetail,
  type PackageClawPackReleaseDetail,
  type PackageClawPackSummary,
} from "../../../../lib/packageApi";

type PluginReleaseLoaderData = {
  detail: PackageDetailResponse;
  resolvedName: string;
  release: PackageClawPackReleaseDetail | null;
  manifest: PackageClawPackManifestDetail | null;
  rateLimited: boolean;
};

export const Route = createFileRoute("/plugins/$name/releases/$version")({
  loader: async ({ params }): Promise<PluginReleaseLoaderData> => {
    const requestedName = params.name;
    const candidateNames = requestedName.includes("/")
      ? [requestedName]
      : [requestedName, `@openclaw/${requestedName}`];

    let resolvedName = requestedName;
    let detail: PackageDetailResponse = { package: null, owner: null };

    for (const candidateName of candidateNames) {
      try {
        const candidateDetail = await fetchPackageDetail(candidateName);
        if (candidateDetail.package) {
          detail = candidateDetail;
          resolvedName = candidateName;
          break;
        }
        detail = candidateDetail;
      } catch (error) {
        if (isRateLimitedPackageApiError(error)) {
          return { detail, resolvedName, release: null, manifest: null, rateLimited: true };
        }
        throw error;
      }
    }

    if (!detail.package) {
      return { detail, resolvedName, release: null, manifest: null, rateLimited: false };
    }

    try {
      const [release, manifest] = await Promise.all([
        fetchPackageClawPack(resolvedName, params.version),
        fetchPackageClawPackManifest(resolvedName, params.version),
      ]);
      return { detail, resolvedName, release, manifest, rateLimited: false };
    } catch (error) {
      if (isRateLimitedPackageApiError(error)) {
        return { detail, resolvedName, release: null, manifest: null, rateLimited: true };
      }
      throw error;
    }
  },
  head: ({ params, loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.detail.package?.displayName ?? params.name} ${params.version} Claw Pack`,
      },
      {
        name: "description",
        content: `Claw Pack artifact details for ${loaderData?.detail.package?.displayName ?? params.name} ${params.version}.`,
      },
    ],
  }),
  component: PluginReleaseRoute,
});

function formatClawPackTarget(target: NonNullable<PackageClawPackSummary["hostTargets"]>[number]) {
  return [target.os, target.arch, target.libc].filter(Boolean).join("-");
}

function formatClawPackBytes(value: number | null | undefined) {
  if (!value || value <= 0) return "unknown";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function clawPackEnvironmentLabels(clawpack: PackageClawPackSummary | null | undefined) {
  const environment = clawpack?.environment;
  if (!environment) return [];
  return [
    environment.requiresLocalDesktop ? "local desktop" : null,
    environment.requiresBrowser ? "browser" : null,
    environment.requiresAudioDevice ? "audio device" : null,
    environment.requiresNetwork ? "network" : null,
    environment.supportsRemoteHost ? "remote host" : null,
    ...(environment.requiresExternalServices ?? []).map((service) => `service:${service}`),
    ...(environment.requiresOsPermissions ?? []).map((permission) => `permission:${permission}`),
    ...(environment.knownUnsupported ?? []).map((target) => `unsupported:${target}`),
  ].filter((label): label is string => Boolean(label));
}

function statusText(status: string | undefined | null) {
  if (!status) return "not recorded";
  return status.replaceAll("-", " ");
}

function PluginReleaseRoute() {
  const { name, version } = Route.useParams();
  const { detail, resolvedName, release, manifest, rateLimited } = Route.useLoaderData();
  const pkg = detail.package;
  const clawpack = release?.clawpack ?? manifest?.clawpack ?? null;
  const manifestJson = manifest?.manifest ? JSON.stringify(manifest.manifest, null, 2) : null;
  const downloadPath =
    release?.links.download ?? (pkg ? getPackageDownloadPath(pkg.name, version) : null);
  const manifestPath =
    release?.links.manifest ?? (pkg ? getPackageClawPackPath(pkg.name, version, "manifest") : null);
  const verifyCommand =
    clawpack?.sha256 && pkg
      ? `clawhub package download ${pkg.name} --version ${version}\nclawhub package verify ${pkg.name.replaceAll("/", "-")}.clawpack.zip --sha256 ${clawpack.sha256}`
      : null;
  const environment = clawPackEnvironmentLabels(clawpack);

  if (rateLimited) {
    return (
      <main className="section">
        <Container size="narrow">
          <Card>
            <CardHeader>
              <CardTitle>Claw Pack temporarily unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[color:var(--ink-soft)]">
                The public plugin API is rate-limited right now.
              </p>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  if (!pkg || !clawpack?.available) {
    return (
      <main className="section">
        <Container size="narrow">
          <Card>
            <CardHeader>
              <CardTitle>Claw Pack unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link to="/plugins/$name" params={{ name }}>
                  <ArrowLeft size={16} />
                  Back to plugin
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  return (
    <main className="section">
      <Container size="wide">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <Button asChild variant="ghost" size="sm" className="w-fit">
              <Link to="/plugins/$name" params={{ name }}>
                <ArrowLeft size={16} />
                Back to plugin
              </Link>
            </Button>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="accent">Claw Pack</Badge>
                  <Badge variant="compact">v{version}</Badge>
                  {pkg.family !== "skill" ? <Badge variant="compact">{pkg.family}</Badge> : null}
                </div>
                <h1 className="m-0 break-words font-display text-3xl font-bold text-[color:var(--ink)]">
                  {pkg.displayName}
                </h1>
                <p className="mt-2 break-all font-mono text-sm text-[color:var(--ink-soft)]">
                  {resolvedName}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {downloadPath ? (
                  <Button asChild size="sm">
                    <a href={downloadPath}>
                      <Download size={16} />
                      Download
                    </a>
                  </Button>
                ) : null}
                {manifestPath ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={manifestPath}>
                      <FileJson size={16} />
                      Manifest
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle>Artifact</CardTitle>
                  {clawpack.sha256 ? (
                    <InstallCopyButton text={clawpack.sha256} ariaLabel="Copy Claw Pack SHA-256" />
                  ) : null}
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                      <dt className="mb-1 text-[color:var(--ink-soft)]">Format</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {clawpack.format ?? "zip"} / spec {clawpack.specVersion ?? "unknown"}
                      </dd>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                      <dt className="mb-1 text-[color:var(--ink-soft)]">Size</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {formatClawPackBytes(clawpack.size)} / {clawpack.fileCount ?? 0} files
                      </dd>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3 sm:col-span-2">
                      <dt className="mb-1 text-[color:var(--ink-soft)]">SHA-256</dt>
                      <dd className="break-all font-mono text-xs text-[color:var(--ink)]">
                        {clawpack.sha256}
                      </dd>
                    </div>
                    {clawpack.manifestSha256 ? (
                      <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3 sm:col-span-2">
                        <dt className="mb-1 text-[color:var(--ink-soft)]">Manifest SHA-256</dt>
                        <dd className="break-all font-mono text-xs text-[color:var(--ink)]">
                          {clawpack.manifestSha256}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </CardContent>
              </Card>

              {manifestJson ? (
                <Card>
                  <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle>CLAWPACK.json</CardTitle>
                    <InstallCopyButton text={manifestJson} ariaLabel="Copy Claw Pack manifest" />
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-[520px] overflow-auto rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 text-xs leading-5 text-[color:var(--ink)]">
                      <code>{manifestJson}</code>
                    </pre>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <aside className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal size={18} />
                    CLI
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {verifyCommand ? (
                    <div className="skill-install-command-wrap">
                      <pre className="skill-install-command">
                        <code>{verifyCommand}</code>
                      </pre>
                      <InstallCopyButton
                        text={verifyCommand}
                        ariaLabel="Copy Claw Pack CLI commands"
                        showLabel={false}
                        className="skill-install-command-inline-button"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Fingerprint size={18} />
                    Targets
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {clawpack.hostTargets?.length
                      ? clawpack.hostTargets.map((target) => (
                          <Badge key={formatClawPackTarget(target)} variant="compact">
                            {formatClawPackTarget(target)}
                          </Badge>
                        ))
                      : "No host targets recorded"}
                  </div>
                  {environment.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {environment.map((label) => (
                        <Badge key={label} variant="compact">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck size={18} />
                    Security
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-3 text-sm">
                    <div>
                      <dt className="text-[color:var(--ink-soft)]">Verification</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {release?.version.verification?.scanStatus ?? "not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[color:var(--ink-soft)]">VirusTotal</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {statusText(release?.version.vtAnalysis?.status)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[color:var(--ink-soft)]">OpenClaw scan</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {statusText(release?.version.llmAnalysis?.status)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[color:var(--ink-soft)]">Static scan</dt>
                      <dd className="font-semibold text-[color:var(--ink)]">
                        {statusText(release?.version.staticScan?.status)}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </Container>
    </main>
  );
}

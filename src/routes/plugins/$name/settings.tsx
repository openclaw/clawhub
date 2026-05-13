import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { DetailBody, DetailPageShell } from "../../../components/DetailPageShell";
import { PublisherNoteSettingsEditor } from "../../../components/PublisherNoteSettingsEditor";
import { SettingsActionRow } from "../../../components/settings/SettingsActionRow";
import { Card } from "../../../components/ui/card";
import { getOpenClawPackageCandidateNames } from "../../../lib/openClawExtensionSlugs";
import { buildPluginDetailHref, parseScopedPackageName } from "../../../lib/pluginRoutes";

function resolvePluginSettingsName(name: string) {
  return getOpenClawPackageCandidateNames(name)[0] ?? name;
}

export const Route = createFileRoute("/plugins/$name/settings")({
  beforeLoad: ({ params }) => {
    if (parseScopedPackageName(params.name)) {
      throw redirect({
        href: `${buildPluginDetailHref(params.name)}/settings`,
        statusCode: 308,
      });
    }
  },
  component: PluginSettingsRoute,
});

function PluginSettingsRoute() {
  const { name } = Route.useParams();
  return <PluginSettingsPage name={name} />;
}

export function PluginSettingsPage({ name }: { name: string }) {
  const candidateNames = getOpenClawPackageCandidateNames(name);
  const resolvedName = resolvePluginSettingsName(name);
  const settings = useQuery(api.packages.getClawScanNoteSettings, {
    name: resolvedName,
    candidateNames,
  });
  const updatePublisherNoteAndRequestRescan = useMutation(
    api.packages.updateLatestClawScanNoteAndRequestRescan,
  );

  if (settings === undefined) {
    return (
      <main className="section detail-page-section" aria-busy="true">
        <DetailPageShell className="skill-settings-page">
          <div className="card">Loading plugin settings...</div>
        </DetailPageShell>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="section detail-page-section">
        <DetailPageShell className="skill-settings-page">
          <div className="skill-settings-page-header">
            <a href={buildPluginDetailHref(resolvedName)} className="skill-settings-back-link">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to plugin
            </a>
            <div>
              <h1 className="skill-settings-page-title">Plugin settings</h1>
            </div>
          </div>
          <DetailBody>
            <Card>
              <h2 className="section-title text-[1.2rem] m-0">Settings unavailable</h2>
              <p className="section-subtitle mt-3 mb-0">
                Only the plugin publisher, an owner org admin, or platform staff can manage these
                settings.
              </p>
            </Card>
          </DetailBody>
        </DetailPageShell>
      </main>
    );
  }

  const latestRelease = settings.latestRelease;
  if (!latestRelease) throw notFound();
  const packageId = settings.package._id;

  async function submitPublisherNoteAndRescan(clawScanNote: string) {
    await updatePublisherNoteAndRequestRescan({
      packageId,
      clawScanNote,
    });
    toast.success("Publisher note saved. Rescan started; this may take a few minutes.");
  }

  return (
    <main className="section detail-page-section">
      <DetailPageShell className="skill-settings-page">
        <div className="skill-settings-page-header">
          <a
            href={buildPluginDetailHref(settings.package.name)}
            className="skill-settings-back-link"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to {settings.package.displayName}
          </a>
          <div>
            <h1 className="skill-settings-page-title">Plugin settings</h1>
          </div>
        </div>
        <DetailBody>
          <div className="skill-admin-panel" data-package-id={settings.package._id}>
            <SettingsActionRow
              title="Publisher note"
              description="Optional context ClawScan can use when reviewing the latest release."
            >
              <PublisherNoteSettingsEditor
                note={latestRelease.clawScanNote}
                onSaveAndRescan={submitPublisherNoteAndRescan}
              />
            </SettingsActionRow>
          </div>
        </DetailBody>
      </DetailPageShell>
    </main>
  );
}

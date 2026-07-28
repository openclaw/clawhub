import { apiRequest } from "../../http.js";
import { ApiCliTelemetryInstallResponseSchema, LegacyApiRoutes } from "../../schema/index.js";

export async function reportInstalledSkillsTelemetryIfEnabled(params: {
  token: string | undefined;
  registry: string;
  slug: string;
  ownerHandle?: string | null;
  sourceRef?: string | null;
  sourceKind?: "skills-sh" | null;
  sourceRepository?: string | null;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  canonicalRef?: string | null;
  clawhubScan?: "unscanned" | "scanned" | null;
  trustLabel?: string | null;
  version?: string | null;
}) {
  if (!params.token || isTelemetryDisabled()) return;
  const slug = params.slug.trim();
  if (!slug) return;

  try {
    await apiRequest(
      params.registry,
      {
        method: "POST",
        path: LegacyApiRoutes.cliTelemetryInstall,
        token: params.token,
        body: {
          event: "install",
          slug,
          ownerHandle: params.ownerHandle ?? undefined,
          sourceRef: params.sourceRef ?? undefined,
          sourceKind: params.sourceKind ?? undefined,
          sourceRepository: params.sourceRepository ?? undefined,
          sourcePath: params.sourcePath ?? undefined,
          sourceUrl: params.sourceUrl ?? undefined,
          canonicalRef: params.canonicalRef ?? undefined,
          clawhubScan: params.clawhubScan ?? undefined,
          trustLabel: params.trustLabel ?? undefined,
          version: params.version ?? undefined,
        },
      },
      ApiCliTelemetryInstallResponseSchema,
    );
  } catch {
    // Install telemetry is best-effort; local installs must not fail because
    // metrics reporting is unavailable.
  }
}

function isTelemetryDisabled() {
  const raw = process.env.CLAWHUB_DISABLE_TELEMETRY ?? process.env.CLAWDHUB_DISABLE_TELEMETRY;
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

import { createHash } from "node:crypto";
import { resolveHome } from "../../homedir.js";
import { apiRequest } from "../../http.js";
import { ApiCliTelemetryInstallResponseSchema, LegacyApiRoutes } from "../../schema/index.js";

export async function reportInstalledSkillsTelemetryIfEnabled(params: {
  token: string | undefined;
  registry: string;
  root: string;
  slug: string;
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
          version: params.version ?? undefined,
          rootId: rootTelemetryId(params.root),
          rootLabel: formatRootLabel(params.root),
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

function rootTelemetryId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function formatRootLabel(value: string) {
  const home = resolveHome();
  if (value === home) return "~";

  const normalized = value.replaceAll("\\", "/");
  const normalizedHome = home.replaceAll("\\", "/");
  const isHome = normalized === normalizedHome || normalized.startsWith(`${normalizedHome}/`);

  const stripped = isHome ? normalized.slice(normalizedHome.length).replace(/^\//, "") : normalized;
  const parts = stripped.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");

  if (!tail) return isHome ? "~" : "…";
  return isHome ? `~/${tail}` : `…/${tail}`;
}

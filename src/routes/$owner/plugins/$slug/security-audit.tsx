import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildPluginSecurityAuditHref,
  packageNameFromPublisherPluginRoute,
} from "../../../../lib/pluginRoutes";
import {
  loadPluginSecurityAudit,
  PluginSecurityAuditPage,
  pluginSecurityAuditHead,
  parsePluginSecurityAuditSearch,
  type PluginSecurityAuditLoaderData,
} from "../../../plugins/$name/security-audit";

function packageNameFromParams(params: { owner: string; slug: string }) {
  const packageName = packageNameFromPublisherPluginRoute(params.owner, params.slug);
  if (!packageName) throw notFound();
  return packageName;
}

async function loadPublisherPluginSecurityAudit(
  params: {
    owner: string;
    slug: string;
  },
  version?: string,
): Promise<PluginSecurityAuditLoaderData> {
  const scopedName = packageNameFromParams(params);
  const scopedData = await loadPluginSecurityAudit(scopedName, version);
  if (scopedData.detail.package) return scopedData;

  const unscopedData = await loadPluginSecurityAudit(params.slug, version);
  if (unscopedData.detail.package?.name && unscopedData.detail.owner?.handle === params.owner) {
    return unscopedData;
  }

  return scopedData;
}

export const Route = createFileRoute("/$owner/plugins/$slug/security-audit")({
  validateSearch: parsePluginSecurityAuditSearch,
  loaderDeps: ({ search }) => ({ version: search.version }),
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params, deps }) => {
    const data = await loadPublisherPluginSecurityAudit(params, deps.version);
    const ownerHandle = data.detail.owner?.handle ?? params.owner;
    const packageName = data.detail.package?.name ?? packageNameFromParams(params);
    const canonicalHref = buildPluginSecurityAuditHref(packageName, {
      ownerHandle,
      version: deps.version,
    });

    if (
      canonicalHref !==
      buildPluginSecurityAuditHref(packageNameFromParams(params), { version: deps.version })
    ) {
      throw redirect({
        href: canonicalHref,
        replace: true,
      });
    }

    return data;
  },
  head: ({ params, loaderData }) =>
    pluginSecurityAuditHead(
      loaderData?.detail.package?.name ?? packageNameFromParams(params),
      loaderData,
    ),
  component: PublisherPluginSecurityAuditRoute,
});

function PublisherPluginSecurityAuditRoute() {
  const params = Route.useParams();
  const loaderData = Route.useLoaderData() as PluginSecurityAuditLoaderData;
  const packageName = loaderData.detail.package?.name ?? packageNameFromParams(params);

  return <PluginSecurityAuditPage name={packageName} loaderData={loaderData} />;
}

import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildPluginSecurityAuditHref,
  packageNameFromPublisherPluginRoute,
} from "../../../../lib/pluginRoutes";
import {
  loadPluginSecurityAudit,
  PluginSecurityAuditPage,
  pluginSecurityAuditHead,
  type PluginSecurityAuditLoaderData,
} from "../../../plugins/$name/security-audit";

function packageNameFromParams(params: { owner: string; slug: string }) {
  const packageName = packageNameFromPublisherPluginRoute(params.owner, params.slug);
  if (!packageName) throw notFound();
  return packageName;
}

async function loadPublisherPluginSecurityAudit(params: {
  owner: string;
  slug: string;
}): Promise<PluginSecurityAuditLoaderData> {
  const scopedName = packageNameFromParams(params);
  const scopedData = await loadPluginSecurityAudit(scopedName);
  if (scopedData.detail.package) return scopedData;

  const unscopedData = await loadPluginSecurityAudit(params.slug);
  if (unscopedData.detail.package?.name && unscopedData.detail.owner?.handle === params.owner) {
    return unscopedData;
  }

  return scopedData;
}

export const Route = createFileRoute("/$owner/plugins/$slug/security-audit")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params }) => {
    const data = await loadPublisherPluginSecurityAudit(params);
    const ownerHandle = data.detail.owner?.handle ?? params.owner;
    const packageName = data.detail.package?.name ?? packageNameFromParams(params);
    const canonicalHref = buildPluginSecurityAuditHref(packageName, { ownerHandle });

    if (canonicalHref !== buildPluginSecurityAuditHref(packageNameFromParams(params))) {
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

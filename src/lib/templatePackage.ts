import { notFound } from "@tanstack/react-router";
import { fetchPackageDetail } from "./packageApi";
import { normalizePublisherHandle, packageNameFromPublisherTemplateRoute } from "./templateRoutes";

export async function loadTemplatePackage(
  params: { owner: string; slug: string },
  view?: "template-detail" | "template-inventory",
) {
  const requestedName = packageNameFromPublisherTemplateRoute(params.owner, params.slug);
  if (!requestedName) throw notFound();
  const requestedOwner = normalizePublisherHandle(params.owner);
  const fetchDetail = (name: string) =>
    view ? fetchPackageDetail(name, view) : fetchPackageDetail(name);
  let detail = await fetchDetail(requestedName);
  if (!detail.package) {
    const unscoped = await fetchDetail(params.slug);
    if (unscoped.package && normalizePublisherHandle(unscoped.owner?.handle) === requestedOwner)
      detail = unscoped;
  }
  if (
    !detail.package ||
    detail.package.family !== "template" ||
    normalizePublisherHandle(detail.owner?.handle) !== requestedOwner
  )
    throw notFound();
  return { ...detail, package: detail.package };
}

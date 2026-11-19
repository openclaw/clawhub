import { httpAction } from "./_generated/server";
import { readTemplateCatalogHttp } from "./lib/templateCategoryListHttpRead";
import { readTemplatePackageHttp } from "./lib/templatePackageHttpRead";

export const get = httpAction(async (ctx, request) => {
  const response =
    new URL(request.url).pathname === "/api/v1/packages/search"
      ? await readTemplateCatalogHttp(ctx, request)
      : await readTemplatePackageHttp(ctx, request);
  if (response) return response;
  const { packagesGetRouterV1Handler } = await import("./httpApiV1/packagesV1");
  return await packagesGetRouterV1Handler(ctx, request);
});

import { httpAction } from "./_generated/server";
import { readTemplatePackageHttp } from "./lib/templatePackageHttpRead";

export const get = httpAction(async (ctx, request) => {
  const response = await readTemplatePackageHttp(ctx, request);
  if (response) return response;
  const { packagesGetRouterV1Handler } = await import("./httpApiV1/packagesV1");
  return await packagesGetRouterV1Handler(ctx, request);
});

import { httpAction } from "./_generated/server";
import { readTemplateCategoryListHttp } from "./lib/templateCategoryListHttpRead";

export const get = httpAction(async (ctx, request) => {
  const response = await readTemplateCategoryListHttp(ctx, request);
  if (response) return response;
  const { listPackagesV1Handler } = await import("./httpApiV1/packagesV1");
  return await listPackagesV1Handler(ctx, request);
});

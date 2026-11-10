import { httpAction } from "./_generated/server";
import { packagesGetRouterV1Handler } from "./httpApiV1/packagesV1";

export const get = httpAction(packagesGetRouterV1Handler);

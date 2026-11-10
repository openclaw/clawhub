import { httpAction } from "./_generated/server";
import { skillsGetRouterV1Handler } from "./httpApiV1/skillsV1";

export const get = httpAction(skillsGetRouterV1Handler);

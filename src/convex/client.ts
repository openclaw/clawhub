import { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { getRequiredRuntimeEnv } from "../lib/runtimeEnv";

const convexUrl = getRequiredRuntimeEnv("VITE_CONVEX_URL");

export const convex = new ConvexReactClient(convexUrl);
export const convexHttp = new ConvexHttpClient(convexUrl);

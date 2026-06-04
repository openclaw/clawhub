import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getRuntimeEnv } from "./runtimeEnv";

export function useAuthStatus() {
  const auth = useConvexAuth();
  const devAuthEnabled = getRuntimeEnv("VITE_ENABLE_DEV_AUTH") === "1";
  const shouldLoadUser = auth.isAuthenticated || devAuthEnabled;
  const userResult = useQuery(api.users.me, shouldLoadUser ? {} : "skip") as
    | Doc<"users">
    | null
    | undefined;
  const isUserLoading = shouldLoadUser && userResult === undefined;
  const me = shouldLoadUser ? userResult : auth.isLoading ? undefined : null;
  const hasActiveUser = Boolean(me);

  return {
    me,
    isAuthenticated: auth.isAuthenticated || hasActiveUser,
    isLoading: hasActiveUser ? false : auth.isLoading || isUserLoading,
  };
}

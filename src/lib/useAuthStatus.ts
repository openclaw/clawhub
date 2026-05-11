import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

export function useAuthStatus() {
  const auth = useConvexAuth();
  const me = useQuery(api.users.me) as Doc<"users"> | null | undefined;

  const isDevImpersonated = !auth.isAuthenticated && !!me;
  const isAuthenticated = auth.isAuthenticated || isDevImpersonated;

  return {
    me,
    isLoading: auth.isLoading,
    isAuthenticated,
    isDevImpersonated,
  };
}

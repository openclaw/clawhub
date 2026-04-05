import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { useAuthStatus } from "../lib/useAuthStatus";

export function UserBootstrap() {
  const { isAuthenticated, isLoading } = useAuthStatus();
  const ensureUser = useMutation(api.users.ensure);
  const didRun = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || didRun.current) return;
    didRun.current = true;
    void ensureUser().catch(() => {
      // Best-effort normalization. Broken auth state should not crash the UI.
    });
  }, [isAuthenticated, isLoading, ensureUser]);

  return null;
}

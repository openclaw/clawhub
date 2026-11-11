import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { AuthFlowSkeleton } from "../../components/skeletons/ProtectedPageSkeletons";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { getUserFacingConvexError } from "../../lib/convexError";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/cli/device")({
  component: CliDeviceAuth,
});

export function CliDeviceAuth() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "deny" | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const actionInFlight = useRef(false);
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const approve = useMutation(api.cliDeviceAuth.approve);
  const deny = useMutation(api.cliDeviceAuth.deny);
  const description = useQuery(
    api.cliDeviceAuth.describePending,
    isAuthenticated && me && code.trim() ? { userCode: code } : "skip",
  );
  const pendingExpiresAt = description?.state === "pending" ? description.expiresAt : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const remaining = pendingExpiresAt === null ? 0 : pendingExpiresAt - now;
    // setTimeout treats a delay above 2^31-1 ms as 1 ms.
    const delay = remaining > 0 ? Math.min(remaining, 2_147_483_647) : 0;
    const timer = delay > 0 ? setTimeout(() => setNow(Date.now()), delay) : undefined;
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [now, pendingExpiresAt]);
  const expiredLocally = pendingExpiresAt !== null && pendingExpiresAt <= now;
  const canDecide = description?.state === "pending" && !expiredLocally && !isComplete;

  const submit = async () => {
    const trimmed = code.trim();
    if (description?.state !== "pending" || description.expiresAt <= Date.now()) return;
    if (!trimmed) {
      setStatus("Enter the code shown in your terminal.");
      return;
    }
    if (actionInFlight.current || isComplete) return;
    actionInFlight.current = true;
    setPendingAction("approve");
    setStatus("Authorizing...");
    try {
      await approve({ userCode: trimmed });
      setIsComplete(true);
      setStatus("Authorized. You can return to your terminal.");
    } catch (error) {
      setStatus(getUserFacingConvexError(error, "Authorization failed."));
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const cancel = async () => {
    const trimmed = code.trim();
    if (description?.state !== "pending" || description.expiresAt <= Date.now() || !trimmed) return;
    if (actionInFlight.current || isComplete) return;
    actionInFlight.current = true;
    setPendingAction("deny");
    setStatus("Denying...");
    try {
      await deny({ userCode: trimmed });
      setIsComplete(true);
      setStatus("Denied. You can close this page.");
    } catch (error) {
      setStatus(getUserFacingConvexError(error, "Deny failed."));
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  if (isLoading) {
    return <AuthFlowSkeleton title="CLI device login" />;
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">CLI device login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isAuthenticated || !me ? (
              <>
                <p className="text-sm text-[color:var(--ink-soft)]">
                  Sign in to authorize the CLI.
                </p>
                <SignInButton disabled={isLoading} />
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="device-code">Code</Label>
                  <Input
                    id="device-code"
                    value={code}
                    onChange={(event) => setCode(event.currentTarget.value)}
                    autoComplete="one-time-code"
                    className="font-mono uppercase"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={submit}
                    disabled={!canDecide || pendingAction !== null}
                  >
                    Authorize
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancel}
                    disabled={!canDecide || pendingAction !== null}
                  >
                    Deny
                  </Button>
                </div>
                <p className="text-sm text-[color:var(--ink-soft)]">
                  Type the code from your terminal. A link does not approve this login, and the code
                  is not filled in for you.
                </p>
                {description?.state === "pending" && !expiredLocally ? (
                  <div className="space-y-1 text-sm">
                    <p>Label: {description.label}</p>
                    <p>Started: {new Date(description.createdAt).toISOString()}</p>
                    <p>This creates a full API token. It can publish and delete as you.</p>
                  </div>
                ) : null}
                {description?.state === "expired" || expiredLocally ? (
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    That code expired. Run <code>clawhub login</code> again and type the new code.
                  </p>
                ) : null}
                {description?.state === "used" ? (
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    That code was already used. If your terminal is not signed in, run{" "}
                    <code>clawhub login</code> again and type the new code.
                  </p>
                ) : null}
                {description?.state === "missing" ? (
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    That code is not waiting for approval. Check the code in your terminal and type
                    it again. If it still does not match, run <code>clawhub login</code> for a new
                    code.
                  </p>
                ) : null}
                {status ? <p className="text-sm text-[color:var(--ink-soft)]">{status}</p> : null}
              </>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}

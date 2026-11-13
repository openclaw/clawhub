import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useLayoutEffect, useRef, useState } from "react";
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

// setTimeout treats a delay above 2^31-1 ms as 1 ms.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * True once the browser clock reaches `deadline`.
 *
 * The clock is read each time the timer is armed, never kept in state: a stored "now" is as old
 * as the render that set it, so a page opened before the code was typed would schedule from that
 * older time and leave the buttons on after expiry. The result is recorded per deadline, so a new
 * code or a new expiry starts again from the current time.
 */
function useDeadlinePassed(deadline: number | null) {
  const [passedDeadline, setPassedDeadline] = useState<number | null>(null);
  // A layout effect, so a deadline that already passed never paints as approvable.
  useLayoutEffect(() => {
    if (deadline === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setPassedDeadline(deadline);
        return;
      }
      timer = setTimeout(check, Math.min(remaining, MAX_TIMER_DELAY_MS));
    };
    check();
    // Timers do not run while the device sleeps or the tab is frozen. Check again on return.
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [deadline]);
  return deadline !== null && passedDeadline === deadline;
}

export function CliDeviceAuth() {
  const [code, setCode] = useState("");
  const [lockedDecision, setLockedDecision] = useState<{
    code: string;
    label: string;
    createdAt: number;
  } | null>(null);
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
  const expiredLocally = useDeadlinePassed(
    description?.state === "pending" ? description.expiresAt : null,
  );
  const canDecide = description?.state === "pending" && !expiredLocally && !isComplete;
  // After this page approves or denies, the row leaves pending and the query reports "used".
  // That is the decision just made here, not a problem with the code.
  const codeProblem = isComplete
    ? null
    : description?.state === "expired" || expiredLocally
      ? "expired"
      : description?.state === "used" || description?.state === "missing"
        ? description.state
        : null;

  const submit = async () => {
    const trimmed = code.trim();
    if (!description || description.state !== "pending" || description.expiresAt <= Date.now()) {
      return;
    }
    if (!trimmed) {
      setStatus("Enter the code shown in your terminal.");
      return;
    }
    if (actionInFlight.current || isComplete || lockedDecision) {
      return;
    }
    actionInFlight.current = true;
    setLockedDecision({
      code: trimmed,
      label: description.label,
      createdAt: description.createdAt,
    });
    setPendingAction("approve");
    setStatus("Authorizing...");
    try {
      await approve({ userCode: trimmed });
      setIsComplete(true);
      setStatus("Authorized. You can return to your terminal.");
    } catch (error) {
      setLockedDecision(null);
      setStatus(getUserFacingConvexError(error, "Authorization failed."));
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const cancel = async () => {
    const trimmed = code.trim();
    if (
      !description ||
      description.state !== "pending" ||
      description.expiresAt <= Date.now() ||
      !trimmed
    ) {
      return;
    }
    if (actionInFlight.current || isComplete || lockedDecision) {
      return;
    }
    actionInFlight.current = true;
    setLockedDecision({
      code: trimmed,
      label: description.label,
      createdAt: description.createdAt,
    });
    setPendingAction("deny");
    setStatus("Denying...");
    try {
      await deny({ userCode: trimmed });
      setIsComplete(true);
      setStatus("Denied. You can close this page.");
    } catch (error) {
      setLockedDecision(null);
      setStatus(getUserFacingConvexError(error, "Deny failed."));
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const shownDecision = lockedDecision
    ? lockedDecision
    : description?.state === "pending" && !expiredLocally
      ? { label: description.label, createdAt: description.createdAt }
      : null;

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
                    value={lockedDecision?.code ?? code}
                    onChange={(event) => {
                      if (lockedDecision) return;
                      setCode(event.currentTarget.value);
                    }}
                    disabled={lockedDecision !== null}
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
                {shownDecision ? (
                  <div className="space-y-1 text-sm">
                    <p>Label: {shownDecision.label}</p>
                    <p>Started: {new Date(shownDecision.createdAt).toISOString()}</p>
                    <p>This creates a full API token. It can publish and delete as you.</p>
                  </div>
                ) : null}
                {codeProblem === "expired" ? (
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    That code expired. Run <code>clawhub login</code> again and type the new code.
                  </p>
                ) : null}
                {codeProblem === "used" ? (
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    That code was already used. If your terminal is not signed in, run{" "}
                    <code>clawhub login</code> again and type the new code.
                  </p>
                ) : null}
                {codeProblem === "missing" ? (
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

import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { AuthFlowSkeleton } from "../../components/skeletons/ProtectedPageSkeletons";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { isCliDeviceUserCode } from "../../lib/cliDeviceCode";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/cli/device")({
  component: CliDeviceAuth,
});

export function CliDeviceAuth() {
  const search = Route.useSearch() as { user_code?: string; code?: string };
  const legacyCode = search.code ?? "";
  const [code, setCode] = useState(
    search.user_code ?? (isCliDeviceUserCode(legacyCode) ? legacyCode : ""),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "deny" | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const actionInFlight = useRef(false);
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const approve = useMutation(api.cliDeviceAuth.approve);
  const deny = useMutation(api.cliDeviceAuth.deny);

  const submit = async () => {
    const trimmed = code.trim();
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
      setStatus(error instanceof Error ? error.message : "Authorization failed.");
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const cancel = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (actionInFlight.current || isComplete) return;
    actionInFlight.current = true;
    setPendingAction("deny");
    setStatus("Denying...");
    try {
      await deny({ userCode: trimmed });
      setIsComplete(true);
      setStatus("Denied. You can close this page.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deny failed.");
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
                    disabled={pendingAction !== null || isComplete}
                  >
                    Authorize
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancel}
                    disabled={pendingAction !== null || isComplete}
                  >
                    Deny
                  </Button>
                </div>
                {status ? <p className="text-sm text-[color:var(--ink-soft)]">{status}</p> : null}
              </>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}

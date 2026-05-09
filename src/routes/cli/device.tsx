import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/cli/device")({
  component: CliDeviceAuth,
});

export function CliDeviceAuth() {
  const search = Route.useSearch() as { code?: string };
  const [code, setCode] = useState(search.code ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const approve = useMutation(api.cliDeviceAuth.approve);
  const deny = useMutation(api.cliDeviceAuth.deny);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setStatus("Enter the code shown in your terminal.");
      return;
    }
    setStatus("Authorizing...");
    try {
      await approve({ userCode: trimmed });
      setStatus("Authorized. You can return to your terminal.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authorization failed.");
    }
  };

  const cancel = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setStatus("Denying...");
    try {
      await deny({ userCode: trimmed });
      setStatus("Denied. You can close this page.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deny failed.");
    }
  };

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
                  <Button type="button" onClick={submit}>
                    Authorize
                  </Button>
                  <Button type="button" variant="outline" onClick={cancel}>
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

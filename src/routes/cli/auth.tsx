import { createFileRoute } from "@tanstack/react-router";
import { Container } from "../../components/layout/Container";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

export const Route = createFileRoute("/cli/auth")({
  component: CliAuth,
});

export function CliAuth() {
  return (
    <main className="py-10">
      <Container size="narrow">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">CLI login has moved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-[color:var(--ink-soft)]">
              <p>
                Browser callback login is no longer supported because it can hand API tokens to
                loopback redirects.
              </p>
              <p>
                Run <code>clawhub login</code> again to use device-code login.
              </p>
            </div>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, CircleHelp, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { Container } from "../components/layout/Container";
import { SignInPrompt } from "../components/SignInPrompt";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { getUserFacingConvexError } from "../lib/convexError";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../lib/ownerRoute";
import { useAuthStatus } from "../lib/useAuthStatus";

const trafficExplanationKinds = ["expected", "not_recognized", "unsure"] as const;
type TrafficExplanationKind = (typeof trafficExplanationKinds)[number];

function isTrafficExplanationKind(value: string): value is TrafficExplanationKind {
  return trafficExplanationKinds.some((kind) => kind === value);
}

export const Route = createFileRoute("/traffic-explanation")({
  validateSearch: (search: Record<string, unknown>) => ({
    signal: typeof search.signal === "string" ? search.signal : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: TrafficExplanationPage,
});

const explanationOptions: Array<{
  kind: TrafficExplanationKind;
  label: string;
  description: string;
}> = [
  {
    kind: "expected",
    label: "Yes, I expected it",
    description: "You shared, promoted, or otherwise expected the increased traffic.",
  },
  {
    kind: "not_recognized",
    label: "No, I don't recognize it",
    description: "You did not cause the traffic and do not know where it came from.",
  },
  {
    kind: "unsure",
    label: "I'm not sure",
    description: "Some activity may be familiar, but the overall numbers are unexpected.",
  },
];

function responseKindLabel(kind: TrafficExplanationKind) {
  return explanationOptions.find((option) => option.kind === kind)?.label ?? kind;
}

function TrafficExplanationPage() {
  const search = Route.useSearch();
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const request = useQuery(
    api.publisherAbuseTrafficExplanation.getForOwner,
    me && search.signal && search.token ? { signalId: search.signal, token: search.token } : "skip",
  );
  const submitExplanation = useMutation(api.publisherAbuseTrafficExplanation.submit);
  const [kind, setKind] = useState<TrafficExplanationKind | null>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthLoading) {
    return <TrafficExplanationSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        title="Sign in to explain this traffic"
        description="Use the ClawHub account that manages the publisher or skill from the email."
      />
    );
  }

  if (!search.signal || !search.token || request === null) {
    return <TrafficExplanationUnavailable />;
  }

  if (request === undefined) {
    return <TrafficExplanationSkeleton />;
  }

  if (request.response) {
    return (
      <TrafficExplanationShell>
        <div className="flex flex-col items-start gap-5">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--oc-radius-control)] border border-status-success-fg/25 bg-status-success-bg text-status-success-fg">
            <CheckCircle2 size={22} aria-hidden="true" />
          </span>
          <div>
            <Badge variant="success" size="sm">
              Response received
            </Badge>
            <h1 className="mt-3 font-display text-2xl font-black text-[color:var(--oc-text-primary)] sm:text-3xl">
              Thanks for the context
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--oc-text-secondary)]">
              Your response for{" "}
              <strong>
                {request.scope === "publisher"
                  ? `@${request.publisherHandle}`
                  : request.skillDisplayName}
              </strong>{" "}
              has been saved for the ClawHub team. Your{" "}
              {request.scope === "publisher" ? "skills" : "skill"} and account remain active.
            </p>
          </div>
          <div className="w-full border-t border-[color:var(--oc-border-subtle)] pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--oc-text-muted)]">
              Your answer
            </p>
            <p className="mt-2 font-semibold text-[color:var(--oc-text-primary)]">
              {responseKindLabel(request.response.kind)}
            </p>
            {request.response.message ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--oc-text-secondary)]">
                {request.response.message}
              </p>
            ) : null}
          </div>
          <Button asChild variant="outline" size="sm">
            {request.scope === "publisher" ? (
              <a href={buildPublisherProfileHref(request.publisherHandle)}>View publisher</a>
            ) : (
              <Link
                to="/$owner/$slug"
                params={{ owner: request.publisherHandle, slug: request.skillSlug }}
              >
                View skill
              </Link>
            )}
          </Button>
        </div>
      </TrafficExplanationShell>
    );
  }

  const messageRequired = kind === "expected";
  const messageValidationError = messageRequired && !message.trim();
  const canSubmit = Boolean(kind && (!messageRequired || message.trim()));

  return (
    <TrafficExplanationShell>
      <div className="flex flex-col gap-6">
        <header>
          <Badge variant="default" size="sm">
            <ShieldCheck size={13} aria-hidden="true" />
            No action taken
          </Badge>
          <h1 className="mt-3 font-display text-2xl font-black text-[color:var(--oc-text-primary)] sm:text-3xl">
            Help us understand this traffic
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--oc-text-secondary)] sm:text-base">
            {request.scope === "publisher" ? (
              <>
                ClawHub noticed unusually high download activity across skills published by{" "}
                <a
                  href={buildPublisherProfileHref(request.publisherHandle)}
                  className="inline-flex min-h-11 items-center font-semibold text-[color:var(--oc-text-link)] underline underline-offset-2"
                >
                  @{request.publisherHandle}
                </a>
                .
              </>
            ) : (
              <>
                ClawHub noticed unusually high download activity for{" "}
                <a
                  href={buildSkillDetailHref(request.publisherHandle, request.skillSlug)}
                  className="inline-flex min-h-11 items-center font-semibold text-[color:var(--oc-text-link)] underline underline-offset-2"
                >
                  {request.skillDisplayName}
                </a>
                .
              </>
            )}
          </p>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[color:var(--oc-text-primary)]">
            Your {request.scope === "publisher" ? "skills" : "skill"} and account remain active.
            This is not a warning or penalty.
          </p>
        </header>

        <form
          className="flex flex-col gap-6 border-t border-[color:var(--oc-border-subtle)] pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!kind || !search.signal || !search.token || !canSubmit) return;
            setIsSubmitting(true);
            setError(null);
            const normalizedMessage = message.trim();
            void submitExplanation({
              signalId: search.signal,
              token: search.token,
              kind,
              ...(normalizedMessage ? { message: normalizedMessage } : {}),
            })
              .catch((submitError: unknown) => {
                setError(
                  getUserFacingConvexError(submitError, "Your response could not be submitted."),
                );
              })
              .finally(() => setIsSubmitting(false));
          }}
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-bold text-[color:var(--oc-text-primary)]">
              Did you expect this traffic?
            </legend>
            {explanationOptions.map((option) => (
              <label
                key={option.kind}
                className="flex cursor-pointer gap-3 rounded-[var(--oc-radius-control)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-control-bg)] p-4 transition-colors hover:bg-[color:var(--oc-control-bg-hover)] has-[:checked]:border-[color:var(--oc-border-accent)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--oc-focus-ring)]"
              >
                <input
                  type="radio"
                  name="traffic-explanation-kind"
                  value={option.kind}
                  checked={kind === option.kind}
                  onChange={(event) => {
                    if (isTrafficExplanationKind(event.target.value)) {
                      setKind(event.target.value);
                    }
                  }}
                  className="mt-1 accent-[color:var(--oc-accent-primary)]"
                  disabled={isSubmitting}
                />
                <span>
                  <strong className="block text-sm text-[color:var(--oc-text-primary)]">
                    {option.label}
                  </strong>
                  <span className="mt-1 block text-sm leading-5 text-[color:var(--oc-text-secondary)]">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="traffic-explanation-message">
              What do you think caused it? {messageRequired ? "(required)" : "(optional)"}
            </Label>
            <Textarea
              id="traffic-explanation-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={3_000}
              rows={6}
              disabled={isSubmitting}
              placeholder="For example: I shared the skill in a newsletter on August 10. I did not run any automated downloads."
              aria-describedby={
                messageValidationError
                  ? "traffic-explanation-help traffic-explanation-message-error"
                  : "traffic-explanation-help"
              }
              aria-invalid={messageValidationError}
            />
            <p
              id="traffic-explanation-help"
              className="text-xs leading-5 text-[color:var(--oc-text-muted)]"
            >
              A link to a post, campaign, or other source is useful when you have one. It is also
              okay to say you do not recognize the traffic.
            </p>
            {messageValidationError ? (
              <p id="traffic-explanation-message-error" className="text-sm text-status-error-fg">
                Tell us what you think caused the traffic before submitting.
              </p>
            ) : null}
          </div>

          {error ? (
            <p
              className="rounded-[var(--oc-radius-control)] border border-status-error-fg/25 bg-status-error-bg px-3 py-2 text-sm text-status-error-fg"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!canSubmit || isSubmitting}>
              Submit explanation
            </Button>
          </div>
        </form>
      </div>
    </TrafficExplanationShell>
  );
}

function TrafficExplanationShell({ children }: { children: ReactNode }) {
  return (
    <main className="py-10 sm:py-14">
      <Container size="narrow">
        <Card className="mx-auto max-w-3xl gap-0 p-5 sm:p-8">
          <CardContent>{children}</CardContent>
        </Card>
      </Container>
    </main>
  );
}

function TrafficExplanationSkeleton() {
  return (
    <main className="py-10 sm:py-14" aria-busy="true" aria-label="Loading traffic request">
      <Container size="narrow">
        <div className="mx-auto h-[430px] max-w-3xl animate-pulse rounded-[var(--oc-radius-surface)] bg-[color:var(--oc-bg-recessed)]" />
      </Container>
    </main>
  );
}

function TrafficExplanationUnavailable() {
  return (
    <TrafficExplanationShell>
      <div className="flex flex-col items-start gap-4 py-4">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--oc-radius-control)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-recessed)] text-[color:var(--oc-text-secondary)]">
          <CircleHelp size={22} aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-black text-[color:var(--oc-text-primary)]">
            This traffic request is unavailable
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[color:var(--oc-text-secondary)]">
            The link may be invalid, or the signed-in account may not manage the skill from the
            email.
          </p>
        </div>
      </div>
    </TrafficExplanationShell>
  );
}

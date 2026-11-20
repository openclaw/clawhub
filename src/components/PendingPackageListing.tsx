import { useRouter, useRouterState } from "@tanstack/react-router";
import { useConvexAuth, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { presentationTitle } from "../lib/presentationTitle";
import { ClientOnly } from "./ClientOnly";
import { EmptyState } from "./EmptyState";
import { Container } from "./layout/Container";
import { PackageContentTabs } from "./PackageContentTabs";
import { Alert, AlertDescription } from "./ui/alert";
import { UserBadge } from "./UserBadge";
import "./template-detail.css";

const query = api.packages.getPendingListingForViewer;
type Target = FunctionArgs<typeof query>;
type Listing = NonNullable<FunctionReturnType<typeof query>>;
type Props = { target: Target } & (
  | { publishedName: string }
  | { notFound: ReactNode; signedOut?: ReactNode; loading: ReactNode }
);

export function isPublisherListingPath(pathname: string) {
  return /^\/[^/]+\/(?:plugins|templates)\/[^/]+\/?$/.test(pathname);
}

/** Never put the private review fields in a router cache, document head, or SSR payload. */
export function PendingPackageListing(props: Props) {
  // Fuzzy route matches and nested audit URLs are never private listing previews.
  const isListing = useRouterState({
    select: (state) => isPublisherListingPath(state.location.pathname),
  });
  if (!isListing) return "notFound" in props ? props.notFound : null;
  // The server can only confirm the public 404. Without JS that is the final state;
  // with JS, show loading only once the client can actually resolve viewer access.
  const fallback = "notFound" in props ? <noscript>{props.notFound}</noscript> : null;
  return (
    <ClientOnly fallback={fallback}>
      <ViewerPendingListing key={JSON.stringify(props.target)} {...props} />
    </ClientOnly>
  );
}

function ViewerPendingListing(props: Props) {
  const { owner, slug, routeKind } = props.target;
  const { isAuthenticated, isLoading } = useConvexAuth();
  const queries = useMemo((): RequestForQueries => {
    if (isLoading || !isAuthenticated) return {};
    return { listing: { query, args: { owner, slug, routeKind } } };
  }, [isLoading, isAuthenticated, owner, slug, routeKind]);
  // Use the non-throwing subscription: a private lookup failure must never replace a public page.
  const result = useQueries(queries).listing as Listing | null | undefined | Error;
  const router = useRouter();
  const [sawPending, setSawPending] = useState(false);
  const hasPending = isAuthenticated && !isLoading && Boolean(result && !(result instanceof Error));
  const reviewEnded = sawPending && isAuthenticated && !isLoading && result === null;
  useEffect(() => {
    if (hasPending) setSawPending(true);
    else if (!isAuthenticated) setSawPending(false);
    if (!reviewEnded) return;
    // Approval, withdrawal, and loss of access all look identical here. Only the
    // normal public loader can decide whether a published page now exists.
    void router
      .invalidate({
        filter: (match) =>
          match.routeId ===
          (routeKind === "plugin" ? "/$owner/plugins/$slug" : "/$owner/templates/$slug"),
      })
      .then(
        () => setSawPending(false),
        () => setSawPending(false),
      );
  }, [hasPending, isAuthenticated, reviewEnded, routeKind, router]);
  if ("publishedName" in props) {
    return !isLoading &&
      isAuthenticated &&
      result &&
      !(result instanceof Error) &&
      result.name === props.publishedName ? (
      <ReviewNotice listing={result} routeKind={routeKind} />
    ) : null;
  }
  if (isLoading || reviewEnded || (isAuthenticated && result === undefined)) return props.loading;
  if (!isAuthenticated) return props.signedOut ?? props.notFound;
  if (!result) return props.notFound;
  if (result instanceof Error) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title="Could not load this listing"
            description="The registry could not return the listing. Please try again."
            action={{ label: "Try again", onClick: () => window.location.reload() }}
          />
        </Container>
      </main>
    );
  }
  return <PreviewShell listing={result} routeKind={routeKind} />;
}

function ReviewNotice({
  listing,
  routeKind,
}: {
  listing: Listing;
  routeKind: Target["routeKind"];
}) {
  return (
    <Alert role="status" className="pending-package-notice" variant="warn">
      <Clock3 size={16} aria-hidden="true" />
      <div className="min-w-0 text-ink [overflow-wrap:anywhere]">
        <p className="m-0 font-semibold">Version {listing.version} is under review</p>
        <AlertDescription className="mt-1 text-ink-soft leading-snug">
          Only the publisher and ClawHub staff can see this release. Once it’s published, anyone can
          view and install it.
          {routeKind === "template" && listing.isAuditEmailRecipient
            ? " We’ll email you the result when the audit is complete."
            : null}
        </AlertDescription>
      </div>
    </Alert>
  );
}

function PreviewShell({
  listing,
  routeKind,
}: {
  listing: Listing;
  routeKind: Target["routeKind"];
}) {
  const isTemplate = routeKind === "template";
  return (
    <main
      className={
        isTemplate ? "template-detail-page" : "section detail-page-section plugin-detail-page"
      }
    >
      <div className={isTemplate ? "template-detail-container" : "skill-detail-stack"}>
        <div className={isTemplate ? "template-detail-layout" : "skill-hero-layout has-sidebar"}>
          <div className={isTemplate ? "template-detail-main" : "skill-hero-main"}>
            <header className={isTemplate ? "template-detail-hero" : "skill-hero-title"}>
              <h1 className={isTemplate ? undefined : "skill-page-title"}>
                {isTemplate
                  ? listing.displayName
                  : presentationTitle(listing.displayName, listing.name)}
              </h1>
              {listing.summary ? (
                <p className={isTemplate ? "template-detail-description" : "section-subtitle"}>
                  {listing.summary}
                </p>
              ) : null}
              <div
                className={
                  isTemplate ? "template-detail-publisher skill-hero-creator" : "skill-hero-creator"
                }
              >
                <UserBadge
                  user={listing.owner}
                  prefix=""
                  size="md"
                  showName
                  showMutedHandle
                  stackMutedHandleBelowName
                />
              </div>
            </header>
            <ReviewNotice listing={listing} routeKind={routeKind} />
            {/* All panes stay locked: switching tabs must never mount a release file loader. */}
            <PackageContentTabs
              routeKind={routeKind}
              renderPanel={() => (
                <p className="m-0 text-sm leading-relaxed text-ink-soft">
                  Release contents will be available after publication.
                </p>
              )}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

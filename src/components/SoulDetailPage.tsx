import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { PublicSoul, PublicUser } from "../lib/publicUser";
import { isModerator } from "../lib/roles";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { useAuthStatus } from "../lib/useAuthStatus";
import { EmptyState } from "./EmptyState";
import { Container } from "./layout/Container";
import { MarkdownPreview } from "./MarkdownPreview";
import { SkillCardSkeletonGrid } from "./skeletons/SkillCardSkeleton";
import { stripFrontmatter } from "./skillDetailUtils";
import { SoulStatsTripletLine } from "./SoulStats";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Textarea } from "./ui/textarea";

type SoulDetailPageProps = {
  slug: string;
};

type PublicSoulVersion = Pick<
  Doc<"soulVersions">,
  | "_id"
  | "_creationTime"
  | "soulId"
  | "version"
  | "fingerprint"
  | "changelog"
  | "changelogSource"
  | "createdBy"
  | "createdAt"
  | "softDeletedAt"
> & {
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    contentType?: string;
  }>;
  parsed?: {
    clawdis?: Doc<"soulVersions">["parsed"]["clawdis"];
  };
};

type SoulBySlugResult = {
  soul: PublicSoul;
  latestVersion: PublicSoulVersion | null;
  owner: PublicUser | null;
} | null;

export function SoulDetailPage({ slug }: SoulDetailPageProps) {
  const { isAuthenticated, me } = useAuthStatus();
  const result = useQuery(api.souls.getBySlug, { slug }) as SoulBySlugResult | undefined;
  const toggleStar = useMutation(api.soulStars.toggle);
  const addComment = useMutation(api.soulComments.add);
  const removeComment = useMutation(api.soulComments.remove);
  const getReadme = useAction(api.souls.getReadme);
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds);
  const seedEnsuredRef = useRef(false);
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const isLoadingSoul = result === undefined;
  const soul = result?.soul;
  const owner = result?.owner;
  const latestVersion = result?.latestVersion;
  const versions = useQuery(
    api.souls.listVersions,
    soul ? { soulId: soul._id, limit: 50 } : "skip",
  ) as PublicSoulVersion[] | undefined;

  const isStarred = useQuery(
    api.soulStars.isStarred,
    isAuthenticated && soul ? { soulId: soul._id } : "skip",
  );

  const comments = useQuery(
    api.soulComments.listBySoul,
    soul ? { soulId: soul._id, limit: 50 } : "skip",
  ) as Array<{ comment: Doc<"soulComments">; user: PublicUser | null }> | undefined;

  const readmeContent = useMemo(() => {
    if (!readme) return null;
    return stripFrontmatter(readme);
  }, [readme]);

  useEffect(() => {
    if (seedEnsuredRef.current) return;
    seedEnsuredRef.current = true;
    void ensureSoulSeeds({});
  }, [ensureSoulSeeds]);

  useEffect(() => {
    if (!latestVersion) return;
    setReadme(null);
    setReadmeError(null);
    let cancelled = false;
    void getReadme({ versionId: latestVersion._id })
      .then((data) => {
        if (cancelled) return;
        setReadme(data.text);
      })
      .catch((error) => {
        if (cancelled) return;
        setReadmeError(error instanceof Error ? error.message : "Failed to load SOUL.md");
        setReadme(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latestVersion, getReadme]);

  if (isLoadingSoul) {
    return (
      <main className="py-10">
        <Container>
          <SkillCardSkeletonGrid count={1} />
        </Container>
      </main>
    );
  }

  if (result === null || !soul) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title="Soul not found"
            description="This soul does not exist or has been removed."
          />
        </Container>
      </main>
    );
  }

  const ownerHandle = owner?.handle ?? owner?.name ?? null;
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const downloadBase = `${convexSiteUrl}/api/v1/souls/${soul.slug}/file`;

  return (
    <main className="py-10">
      <Container>
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                  <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
                    {soul.displayName}
                  </h1>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    {soul.summary ?? "No summary provided."}
                  </p>
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    <SoulStatsTripletLine stats={soul.stats} versionSuffix="versions" />
                  </div>
                  {ownerHandle ? (
                    <div className="text-sm text-[color:var(--ink-soft)]">
                      by{" "}
                      <a
                        href={`/u/${ownerHandle}`}
                        className="text-[color:var(--accent)] hover:underline"
                      >
                        @{ownerHandle}
                      </a>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {isAuthenticated ? (
                      <button
                        className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                          isStarred
                            ? "border-amber-400 bg-amber-50 text-amber-500 dark:bg-amber-900/30"
                            : "border-[color:var(--line)] text-[color:var(--ink-soft)] hover:border-amber-300 hover:text-amber-400"
                        }`}
                        type="button"
                        onClick={() => void toggleStar({ soulId: soul._id })}
                        aria-label={isStarred ? "Unstar soul" : "Star soul"}
                      >
                        <span aria-hidden="true">&#9733;</span>
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex flex-col items-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-2">
                    <span className="text-xs text-[color:var(--ink-soft)]">Current version</span>
                    <strong>v{latestVersion?.version ?? "\u2014"}</strong>
                  </div>
                  <a
                    href={`${downloadBase}?path=SOUL.md`}
                    aria-label="Download SOUL.md"
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-sm min-h-[44px] rounded-[var(--radius-pill)] px-4 py-[11px] border-none bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-deep)] text-white transition-all duration-200 no-underline hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]"
                  >
                    Download SOUL.md
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              {readmeContent ? (
                <MarkdownPreview>{readmeContent}</MarkdownPreview>
              ) : readmeError ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  Failed to load SOUL.md: {readmeError}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Versions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] overflow-y-auto">
                <div className="flex flex-col gap-3">
                  {(versions ?? []).map((version) => (
                    <div
                      key={version._id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] px-3 py-2"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="text-sm">
                          v{version.version} &middot;{" "}
                          {new Date(version.createdAt).toLocaleDateString()}
                          {version.changelogSource === "auto" ? (
                            <span className="text-[color:var(--ink-soft)]"> &middot; auto</span>
                          ) : null}
                        </div>
                        <div className="whitespace-pre-wrap break-words text-sm text-[color:var(--ink-soft)]">
                          {version.changelog}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <a
                          className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-xs min-h-[34px] rounded-[var(--radius-pill)] px-3 py-1.5 border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] transition-all duration-200 no-underline hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]"
                          href={`${downloadBase}?path=SOUL.md&version=${encodeURIComponent(
                            version.version,
                          )}`}
                        >
                          SOUL.md
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Comments</CardTitle>
            </CardHeader>
            <CardContent>
              {isAuthenticated ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!comment.trim()) return;
                    void addComment({ soulId: soul._id, body: comment.trim() }).then(() =>
                      setComment(""),
                    );
                  }}
                  className="flex flex-col gap-3"
                >
                  <Textarea
                    rows={4}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Leave a note..."
                  />
                  <Button variant="default" type="submit" className="self-start">
                    Post comment
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-[color:var(--ink-soft)]">Sign in to comment.</p>
              )}
              <div className="mt-4 flex flex-col gap-3">
                {(comments ?? []).length === 0 ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">No comments yet.</div>
                ) : (
                  (comments ?? []).map((entry) => (
                    <div
                      key={entry.comment._id}
                      className="flex items-start justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] px-3 py-2"
                    >
                      <div className="flex flex-col gap-1">
                        <strong className="text-sm">
                          @{entry.user?.handle ?? entry.user?.name ?? "user"}
                        </strong>
                        <div className="whitespace-pre-wrap break-words text-sm text-[color:var(--ink)]">
                          {entry.comment.body}
                        </div>
                      </div>
                      {isAuthenticated &&
                      me &&
                      (me._id === entry.comment.userId || isModerator(me)) ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void removeComment({ commentId: entry.comment._id })}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}

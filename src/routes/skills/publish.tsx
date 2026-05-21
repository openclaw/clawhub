import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { MAX_CLAWSCAN_NOTE_CHARS, normalizeClawScanNote } from "clawhub-schema";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
} from "clawhub-schema/licenseConstants";
import { normalizeTextContentType } from "clawhub-schema/textFiles";
import { useAction, useMutation, useQuery } from "convex/react";
import { Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import semver from "semver";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { MAX_PUBLISH_FILE_BYTES, MAX_PUBLISH_TOTAL_BYTES } from "../../../convex/lib/publishLimits";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { SkillIconPicker } from "../../components/SkillIconPicker";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { getSiteMode } from "../../lib/site";
import { ALLOWED_LUCIDE_ICONS, makeLucideIconValue, parseSkillIcon } from "../../lib/skillIcon";
import { getPublicSlugCollision } from "../../lib/slugCollision";
import { expandDroppedItems, expandFilesWithReport } from "../../lib/uploadFiles";
import { useAuthStatus } from "../../lib/useAuthStatus";
import {
  formatBytes,
  formatPublishError,
  hashFile,
  isTextFile,
  readText,
  uploadFile,
} from "../upload/-utils";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PublisherMembership = {
  publisher: {
    _id: string;
    handle: string;
    displayName: string;
    kind: "user" | "org";
  };
  role: "owner" | "admin" | "publisher";
};

export const Route = createFileRoute("/skills/publish")({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === "string" ? search.updateSlug : undefined,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  component: Upload,
});

export function Upload() {
  const { isAuthenticated, me } = useAuthStatus();
  const { updateSlug, ownerHandle: searchOwnerHandle } = useSearch({ from: "/skills/publish" });
  const siteMode = getSiteMode();
  const isSoulMode = siteMode === "souls";
  const requiredFileLabel = isSoulMode ? "SOUL.md" : "SKILL.md";
  const contentLabel = isSoulMode ? "soul" : "skill";

  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const publishVersion = useAction(
    isSoulMode ? api.souls.publishVersion : api.skills.publishVersion,
  );
  const generateChangelogPreview = useAction(
    isSoulMode ? api.souls.generateChangelogPreview : api.skills.generateChangelogPreview,
  );
  const existingSkill = useQuery(
    api.skills.getBySlug,
    !isSoulMode && updateSlug ? { slug: updateSlug } : "skip",
  );
  const existingSoul = useQuery(
    api.souls.getBySlug,
    isSoulMode && updateSlug ? { slug: updateSlug } : "skip",
  );
  const existing = (isSoulMode ? existingSoul : existingSkill) as
    | {
        skill?: { slug: string; displayName: string; icon?: string | null };
        soul?: { slug: string; displayName: string };
        latestVersion?: { version: string; clawScanNote?: string | null };
        // Present on skills.getBySlug; absent on souls.getBySlug. Used to
        // default the Owner selector to the skill's current owner in update
        // mode so a New Version publish does not silently re-own the skill.
        owner?: { handle: string; displayName?: string };
      }
    | null
    | undefined;

  const [hasAttempted, setHasAttempted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredMacJunkPaths, setIgnoredMacJunkPaths] = useState<string[]>([]);
  const [slug, setSlug] = useState(updateSlug ?? "");
  const [displayName, setDisplayName] = useState("");
  // Selected lucide icon name (e.g. `Plug`) or null when "no icon". Skills only;
  // souls don't expose a custom icon yet.
  const [iconName, setIconName] = useState<string | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [tags, setTags] = useState("latest");
  const [acceptedLicenseTerms, setAcceptedLicenseTerms] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [changelogStatus, setChangelogStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [changelogSource, setChangelogSource] = useState<"auto" | "user" | null>(null);
  const [clawScanNote, setClawScanNote] = useState("");
  const changelogTouchedRef = useRef(false);
  const clawScanNoteTouchedRef = useRef(false);
  // Tracks whether the publisher has interacted with the Skill icon picker
  // during this session. Used by the submit handler to honour the "key
  // omitted = leave existing alone" branch in skill mode: a routine New
  // Version publish that never touches the picker must NOT forward an
  // empty `icon: ""` (which the backend would treat as an explicit
  // clear). This protects against silently wiping a custom icon when
  // pre-population fails — for example after the client allow-list is
  // pruned in a future deploy and the stored lucide name no longer
  // resolves.
  const iconTouchedRef = useRef(false);
  const changelogRequestRef = useRef(0);
  const changelogKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const isSubmitting = status !== null;
  const [error, setError] = useState<string | null>(null);
  const publisherMemberships = useQuery(api.publishers.listMine) as
    | PublisherMembership[]
    | undefined;
  const [ownerHandle, setOwnerHandle] = useState(searchOwnerHandle ?? "");
  const ownerTouchedRef = useRef(false);
  // Owner migration opt-in: when updating an existing skill under a different
  // publisher than its current owner, the backend requires an explicit
  // `migrateOwner: true` signal. We only send it when the user ticks this box,
  // so a wrong default in the Owner selector cannot silently transfer
  // ownership.
  const [confirmMigrateOwner, setConfirmMigrateOwner] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setFileInputRef = (node: HTMLInputElement | null) => {
    fileInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };
  const navigate = useNavigate();
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const stripRoot = useMemo(() => {
    if (files.length === 0) return null;
    const paths = files.map((file) => (file.webkitRelativePath || file.name).replace(/^\.\//, ""));
    if (!paths.every((path) => path.includes("/"))) return null;
    const firstSegment = paths[0]?.split("/")[0];
    if (!firstSegment) return null;
    if (!paths.every((path) => path.startsWith(`${firstSegment}/`))) return null;
    return firstSegment;
  }, [files]);
  const normalizedPaths = useMemo(
    () =>
      files.map((file) => {
        const raw = (file.webkitRelativePath || file.name).replace(/^\.\//, "");
        if (stripRoot && raw.startsWith(`${stripRoot}/`)) {
          return raw.slice(stripRoot.length + 1);
        }
        return raw;
      }),
    [files, stripRoot],
  );
  const hasRequiredFile = useMemo(
    () =>
      normalizedPaths.some((path) => {
        const lower = path.trim().toLowerCase();
        return isSoulMode ? lower === "soul.md" : lower === "skill.md" || lower === "skills.md";
      }),
    [isSoulMode, normalizedPaths],
  );
  const sizeLabel = totalBytes ? formatBytes(totalBytes) : "0 B";
  const oversizedFiles = useMemo(
    () => files.filter((file) => file.size > MAX_PUBLISH_FILE_BYTES),
    [files],
  );
  const oversizedFileNames = useMemo(
    () => oversizedFiles.slice(0, 3).map((file) => file.name),
    [oversizedFiles],
  );
  const ignoredMacJunkNote = useMemo(() => {
    if (ignoredMacJunkPaths.length === 0) return null;
    const labels = Array.from(
      new Set(ignoredMacJunkPaths.map((path) => path.split("/").at(-1) ?? path)),
    ).slice(0, 3);
    const suffix = ignoredMacJunkPaths.length > 3 ? ", ..." : "";
    const count = ignoredMacJunkPaths.length;
    return `Ignored ${count} macOS junk file${count === 1 ? "" : "s"} (${labels.join(", ")}${suffix})`;
  }, [ignoredMacJunkPaths]);
  const trimmedSlug = slug.trim();
  const trimmedName = displayName.trim();
  const trimmedChangelog = changelog.trim();
  const trimmedClawScanNote = clawScanNote.trim();
  const normalizedClawScanNote =
    !isSoulMode &&
    trimmedClawScanNote.length > 0 &&
    trimmedClawScanNote.length <= MAX_CLAWSCAN_NOTE_CHARS
      ? normalizeClawScanNote(clawScanNote)
      : undefined;
  const trimmedVersion = version.trim();
  const slugAvailability = useQuery(
    api.skills.checkSlugAvailability,
    !isSoulMode && isAuthenticated && ownerHandle && trimmedSlug && SLUG_PATTERN.test(trimmedSlug)
      ? { slug: trimmedSlug.toLowerCase(), ownerHandle }
      : "skip",
  ) as
    | {
        available: boolean;
        reason: "available" | "taken" | "reserved";
        message: string | null;
        url: string | null;
      }
    | null
    | undefined;
  const slugCollision = useMemo(
    () =>
      getPublicSlugCollision({
        isSoulMode,
        slug: trimmedSlug,
        result: slugAvailability,
      }),
    [isSoulMode, slugAvailability, trimmedSlug],
  );

  useEffect(() => {
    if (!existing?.latestVersion || (!existing?.skill && !existing?.soul)) return;
    const name = existing.skill?.displayName ?? existing.soul?.displayName;
    const nextSlug = existing.skill?.slug ?? existing.soul?.slug;
    if (nextSlug) setSlug(nextSlug);
    if (name) setDisplayName(name);
    // Pre-populate the icon picker from the existing skill so a New Version
    // publish keeps the previously selected icon unless the user changes it.
    if (!isSoulMode && existing.skill?.icon !== undefined) {
      const parsed = parseSkillIcon(existing.skill.icon ?? null);
      setIconName(parsed?.kind === "lucide" ? parsed.name : null);
    }
    const nextVersion = semver.inc(existing.latestVersion.version, "patch");
    if (nextVersion) setVersion(nextVersion);
    if (!isSoulMode && !clawScanNoteTouchedRef.current) {
      setClawScanNote(existing.latestVersion.clawScanNote ?? "");
    }
  }, [existing, isSoulMode]);

  useEffect(() => {
    if (isSoulMode) return;

    // In update mode, default the Owner selector to the skill's current owner
    // so the New Version flow is a same-owner republish by default and does
    // not require an ownership-migration opt-in for the common case.
    const existingOwnerHandle = existing?.owner?.handle;
    const memberships = publisherMemberships ?? [];
    if (memberships.length === 0) {
      if (!ownerHandle && existingOwnerHandle) {
        setOwnerHandle(existingOwnerHandle);
      }
      return;
    }

    const currentOwnerExists = ownerHandle
      ? memberships.some((entry) => entry.publisher.handle === ownerHandle)
      : false;
    const existingOwner = existingOwnerHandle
      ? memberships.find((entry) => entry.publisher.handle === existingOwnerHandle)
      : undefined;
    const shouldPreferExistingOwner = Boolean(
      !ownerTouchedRef.current &&
      updateSlug &&
      existingOwner &&
      ownerHandle !== existingOwner.publisher.handle,
    );
    if (currentOwnerExists && !shouldPreferExistingOwner) return;

    const personalPublisher = memberships.find((entry) => entry.publisher.kind === "user");
    const nextOwnerHandle =
      existingOwner?.publisher.handle ??
      personalPublisher?.publisher.handle ??
      memberships[0]?.publisher.handle;
    if (!nextOwnerHandle || nextOwnerHandle === ownerHandle) return;

    // Convex subscriptions can replace the owner option list after the first
    // render. Keep the controlled select value aligned so submit does not send
    // a stale handle while the DOM displays the replacement option.
    setOwnerHandle(nextOwnerHandle);
    setConfirmMigrateOwner(false);
  }, [ownerHandle, publisherMemberships, existing?.owner?.handle, updateSlug, isSoulMode]);

  useEffect(() => {
    if (changelogTouchedRef.current) return;
    if (trimmedChangelog) return;
    if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) return;
    if (!semver.valid(trimmedVersion)) return;
    if (!hasRequiredFile) return;
    if (files.length === 0) return;

    const requiredIndex = normalizedPaths.findIndex((path) => {
      const lower = path.trim().toLowerCase();
      return isSoulMode ? lower === "soul.md" : lower === "skill.md" || lower === "skills.md";
    });
    if (requiredIndex < 0) return;

    const requiredFile = files[requiredIndex];
    if (!requiredFile) return;

    const key = `${trimmedSlug}:${trimmedVersion}:${requiredFile.size}:${requiredFile.lastModified}:${normalizedPaths.length}`;
    if (changelogKeyRef.current === key) return;
    changelogKeyRef.current = key;

    const requestId = ++changelogRequestRef.current;
    setChangelogStatus("loading");

    void readText(requiredFile)
      .then((text) => {
        if (changelogRequestRef.current !== requestId) return null;
        return generateChangelogPreview({
          slug: trimmedSlug,
          version: trimmedVersion,
          readmeText: text.slice(0, 20_000),
          filePaths: normalizedPaths,
        });
      })
      .then((result) => {
        if (!result) return;
        if (changelogRequestRef.current !== requestId) return;
        setChangelog(result.changelog);
        setChangelogSource("auto");
        setChangelogStatus("ready");
      })
      .catch(() => {
        if (changelogRequestRef.current !== requestId) return;
        setChangelogStatus("error");
      });
  }, [
    files,
    generateChangelogPreview,
    hasRequiredFile,
    isSoulMode,
    normalizedPaths,
    trimmedChangelog,
    trimmedSlug,
    trimmedVersion,
  ]);
  // Detect ownership migration intent. We only treat it as a migration when:
  //   * updating an existing skill (`updateSlug` + loaded existing),
  //   * the caller has picked a different Owner than the skill currently has,
  //   * not in soul mode (souls don't carry a publisher owner).
  // The submit button is disabled until the user ticks the explicit
  // `confirmMigrateOwner` checkbox, mirroring the backend's `migrateOwner`
  // contract.
  const existingOwnerHandle = !isSoulMode ? (existing?.owner?.handle ?? null) : null;
  const isOwnerMigration = Boolean(
    !isSoulMode &&
    updateSlug &&
    existingOwnerHandle &&
    ownerHandle &&
    ownerHandle !== existingOwnerHandle,
  );
  const effectiveSlugCollision = isOwnerMigration && confirmMigrateOwner ? null : slugCollision;
  const parsedTags = useMemo(
    () =>
      tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  );
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!trimmedSlug) {
      issues.push("Slug is required.");
    } else if (!SLUG_PATTERN.test(trimmedSlug)) {
      issues.push("Slug must be lowercase and use dashes only.");
    }
    if (!trimmedName) {
      issues.push("Display name is required.");
    }
    if (!semver.valid(trimmedVersion)) {
      issues.push("Version must be valid semver (e.g. 1.0.0).");
    }
    if (parsedTags.length === 0) {
      issues.push("At least one tag is required.");
    }
    if (!isSoulMode && !acceptedLicenseTerms) {
      issues.push("Accept the MIT-0 license terms to publish this skill.");
    }
    if (!isSoulMode && trimmedClawScanNote.length > MAX_CLAWSCAN_NOTE_CHARS) {
      issues.push(`ClawScan note must be at most ${MAX_CLAWSCAN_NOTE_CHARS} characters.`);
    }
    if (files.length === 0) {
      issues.push("Add at least one file.");
    }
    if (!hasRequiredFile) {
      issues.push(`${requiredFileLabel} is required.`);
    }
    if (isOwnerMigration && !confirmMigrateOwner) {
      issues.push(
        `Confirm the ownership move from @${existingOwnerHandle} to @${ownerHandle} to publish.`,
      );
    }
    const invalidFiles = files.filter((file) => !isTextFile(file));
    if (invalidFiles.length > 0) {
      issues.push(
        `Remove non-text files: ${invalidFiles
          .slice(0, 3)
          .map((file) => file.name)
          .join(", ")}`,
      );
    }
    if (oversizedFiles.length > 0) {
      issues.push(`Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`);
    }
    if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
      issues.push("Total file size exceeds 50MB.");
    }
    if (effectiveSlugCollision) {
      issues.push(effectiveSlugCollision.message);
    }
    return {
      issues,
      ready: issues.length === 0,
    };
  }, [
    trimmedSlug,
    trimmedName,
    trimmedVersion,
    trimmedClawScanNote.length,
    parsedTags.length,
    acceptedLicenseTerms,
    files,
    hasRequiredFile,
    isSoulMode,
    totalBytes,
    oversizedFiles.length,
    oversizedFileNames,
    requiredFileLabel,
    effectiveSlugCollision,
    isOwnerMigration,
    confirmMigrateOwner,
    existingOwnerHandle,
    ownerHandle,
  ]);
  const slugIssue = validation.issues.find(
    (issue) =>
      issue === "Slug is required." ||
      issue.startsWith("Slug must ") ||
      issue === effectiveSlugCollision?.message,
  );
  const displayNameIssue = validation.issues.find((issue) => issue === "Display name is required.");
  const versionIssue = validation.issues.find((issue) => issue.startsWith("Version must "));
  const ownerIssue = validation.issues.find((issue) => issue.startsWith("Confirm the ownership "));

  // webkitdirectory/directory attributes are set via the ref callback (setFileInputRef)
  // to ensure they persist across hydration and re-renders (#58)

  if (!isAuthenticated) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title={`Sign in to publish a ${contentLabel}`}
            description="You need to be signed in to publish skills on ClawHub."
          >
            <SignInButton />
          </EmptyState>
        </Container>
      </main>
    );
  }

  async function applyExpandedFiles(selected: File[]) {
    const report = await expandFilesWithReport(selected);
    setFiles(report.files);
    setIgnoredMacJunkPaths(report.ignoredMacJunkPaths);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setHasAttempted(true);
    if (!validation.ready) {
      const message = validation.issues[0] ?? "Fix validation issues to continue.";
      setError(message);
      toast.error(message);
      return;
    }
    if (effectiveSlugCollision) {
      setError(effectiveSlugCollision.message);
      toast.error(effectiveSlugCollision.message);
      return;
    }
    if (!isSoulMode && !acceptedLicenseTerms) {
      const msg = "Accept the MIT-0 license terms to publish this skill.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setError(null);
    if (oversizedFiles.length > 0) {
      const msg = `Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`;
      setError(msg);
      toast.error(msg);
      return;
    }
    if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
      const msg = "Total size exceeds 50MB per version.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!hasRequiredFile) {
      const msg = `${requiredFileLabel} is required.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    setStatus("Uploading files…");

    const uploaded = [] as Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }>;

    for (const file of files) {
      const uploadUrl = await generateUploadUrl();
      const rawPath = (file.webkitRelativePath || file.name).replace(/^\.\//, "");
      const path =
        stripRoot && rawPath.startsWith(`${stripRoot}/`)
          ? rawPath.slice(stripRoot.length + 1)
          : rawPath;
      const sha256 = await hashFile(file);
      const storageId = await uploadFile(uploadUrl, file);
      uploaded.push({
        path,
        size: file.size,
        storageId,
        sha256,
        contentType: normalizeTextContentType(path, file.type) ?? file.type ?? undefined,
      });
    }

    setStatus("Publishing…");
    try {
      // Skill mode forwards an `icon` field only when the picker has
      // actually been touched in this session, so the form is the single
      // source of truth for the tri-state contract:
      //   * touched + whitelisted name → `lucide:<Name>` (set)
      //   * touched + None / unparseable selection → `""` (clear)
      //   * untouched (or soul mode) → field omitted (keep existing)
      // The backend treats blank input as "clear the icon" and a missing
      // key as "keep whatever is already stored", so the omit branch is
      // what protects routine version bumps from silently wiping an
      // existing custom icon when pre-population fails (e.g. the stored
      // lucide name was pruned from `ALLOWED_LUCIDE_ICONS`).
      let iconPayload: string | undefined;
      if (isSoulMode || !iconTouchedRef.current) {
        iconPayload = undefined;
      } else if (iconName && Object.hasOwn(ALLOWED_LUCIDE_ICONS, iconName)) {
        iconPayload = makeLucideIconValue(iconName as keyof typeof ALLOWED_LUCIDE_ICONS);
      } else {
        iconPayload = "";
      }
      const result = await publishVersion({
        ownerHandle: isSoulMode ? undefined : ownerHandle || undefined,
        // Only propagate the migration opt-in when the user is actually
        // changing the skill's owner AND has explicitly confirmed the move.
        // Same-owner republishes must never carry `migrateOwner: true`.
        migrateOwner: !isSoulMode && isOwnerMigration && confirmMigrateOwner ? true : undefined,
        slug: trimmedSlug,
        displayName: trimmedName,
        ...(iconPayload !== undefined ? { icon: iconPayload } : {}),
        version: trimmedVersion,
        changelog: trimmedChangelog,
        ...(normalizedClawScanNote ? { clawScanNote: normalizedClawScanNote } : {}),
        acceptLicenseTerms: isSoulMode ? undefined : acceptedLicenseTerms,
        tags: parsedTags,
        files: uploaded,
      });
      setStatus(null);
      setError(null);
      setHasAttempted(false);
      setChangelogSource("user");
      if (result) {
        toast.success(`Published ${trimmedSlug}@${trimmedVersion}`);
        const ownerParam = ownerHandle || me?.handle || (me?._id ? String(me._id) : "unknown");
        void navigate({
          to: isSoulMode ? "/souls/$slug" : "/$owner/$slug",
          params: isSoulMode ? { slug: trimmedSlug } : { owner: ownerParam, slug: trimmedSlug },
        });
      }
    } catch (publishError) {
      setStatus(null);
      const message = formatPublishError(publishError);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <header className="flex flex-col gap-2 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
              Publish a {contentLabel}
            </h1>
            <p className="text-sm text-[color:var(--ink-soft)]">
              Drop a folder with {requiredFileLabel} and text files. We will handle the rest.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Metadata panel */}
          <Card>
            <CardContent>
              <Label htmlFor="slug">Slug</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder={`${contentLabel}-name`}
                />
                {trimmedSlug && SLUG_PATTERN.test(trimmedSlug) && slugAvailability ? (
                  <Badge variant={slugAvailability.available ? "success" : "destructive"}>
                    {slugAvailability.available ? "Available" : "Taken"}
                  </Badge>
                ) : null}
              </div>
              <InlineValidationMessage id="slug-validation-error" message={slugIssue} />

              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={`My ${contentLabel}`}
              />
              <InlineValidationMessage
                id="display-name-validation-error"
                message={displayNameIssue}
              />

              {!isSoulMode ? (
                <>
                  {/* The picker is a custom radiogroup; the visible "Icon"
                      heading is decorative and does not need `htmlFor` —
                      `SkillIconPicker` exposes its own `aria-label`. */}
                  <Label>Icon</Label>
                  <SkillIconPicker
                    value={iconName}
                    onChange={(next) => {
                      // Mark the picker as user-touched so the submit
                      // handler knows it can forward the resulting value
                      // (including `null` → "") instead of falling back
                      // to the omit-key branch.
                      iconTouchedRef.current = true;
                      setIconName(next);
                    }}
                  />
                </>
              ) : null}

              {!isSoulMode ? (
                <>
                  <Label htmlFor="ownerHandle">Owner</Label>
                  <select
                    className="w-full min-h-[44px] rounded-[var(--radius-sm)] border px-3.5 py-[13px] text-[color:var(--ink)] transition-all duration-[180ms] ease-out border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] focus:outline-none focus:border-[color-mix(in_srgb,var(--accent)_70%,white)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                    id="ownerHandle"
                    value={ownerHandle}
                    onChange={(event) => {
                      ownerTouchedRef.current = true;
                      setOwnerHandle(event.target.value);
                      // Reset the migration confirmation any time the Owner
                      // selector changes; the user must re-acknowledge the move
                      // after picking a different target to avoid a stale tick
                      // turning into a silent transfer.
                      setConfirmMigrateOwner(false);
                    }}
                  >
                    {(publisherMemberships ?? []).map((entry) => (
                      <option key={entry.publisher._id} value={entry.publisher.handle}>
                        @{entry.publisher.handle} · {entry.publisher.displayName}
                      </option>
                    ))}
                  </select>
                  {isOwnerMigration ? (
                    <label className="flex items-start gap-2 text-sm cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmMigrateOwner}
                        onChange={(event) => setConfirmMigrateOwner(event.target.checked)}
                      />
                      <span>
                        Move ownership of <strong>{trimmedSlug || "this skill"}</strong> from{" "}
                        <strong>@{existingOwnerHandle}</strong> to <strong>@{ownerHandle}</strong>.
                        Versions, tags, stats, comments and stars are preserved; the old URL
                        redirects to the new one.
                      </span>
                    </label>
                  ) : null}
                  <InlineValidationMessage id="owner-validation-error" message={ownerIssue} />
                </>
              ) : null}

              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="1.0.0"
              />
              <InlineValidationMessage id="version-validation-error" message={versionIssue} />

              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="latest, stable"
              />

              {!isSoulMode ? (
                <>
                  <Label htmlFor="clawScanNote">ClawScan note</Label>
                  <Textarea
                    id="clawScanNote"
                    rows={4}
                    value={clawScanNote}
                    maxLength={MAX_CLAWSCAN_NOTE_CHARS + 1}
                    onChange={(event) => {
                      clawScanNoteTouchedRef.current = true;
                      setClawScanNote(event.target.value);
                    }}
                    placeholder="Optional context for ClawScan, e.g. why this version needs network access."
                  />
                </>
              ) : null}
              {validation.issues.some(
                (issue) =>
                  issue.startsWith("Slug") ||
                  issue.startsWith("Display name") ||
                  issue.startsWith("Version") ||
                  issue.startsWith("At least one tag") ||
                  issue.startsWith("ClawScan note") ||
                  issue.includes("already exists"),
              ) ? (
                <ul className="flex flex-col gap-1 list-disc pl-5 text-sm text-[color:var(--ink-soft)]">
                  {validation.issues
                    .filter(
                      (issue) =>
                        issue.startsWith("Slug") ||
                        issue.startsWith("Display name") ||
                        issue.startsWith("Version") ||
                        issue.startsWith("At least one tag") ||
                        issue.startsWith("ClawScan note") ||
                        issue.includes("already exists"),
                    )
                    .map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                </ul>
              ) : null}
              {effectiveSlugCollision?.url ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  Existing skill:{" "}
                  <a
                    href={effectiveSlugCollision.url}
                    className="text-[color:var(--accent)] hover:underline"
                  >
                    {effectiveSlugCollision.url}
                  </a>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* File upload panel */}
          <Card>
            <CardContent>
              <label
                className={`flex flex-col items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed p-8 transition-colors cursor-pointer ${
                  isDragging
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5"
                    : "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  const items = event.dataTransfer.items;
                  void (async () => {
                    const dropped = items?.length
                      ? await expandDroppedItems(items)
                      : Array.from(event.dataTransfer.files);
                    await applyExpandedFiles(dropped);
                  })();
                }}
              >
                <input
                  ref={setFileInputRef}
                  className="sr-only"
                  id="upload-files"
                  data-testid="upload-input"
                  type="file"
                  multiple
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    void applyExpandedFiles(picked);
                  }}
                />
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex items-center gap-3">
                    <UploadIcon className="h-5 w-5 text-[color:var(--ink-soft)]" />
                    <strong>Drop a folder</strong>
                    <span className="text-xs font-medium text-[color:var(--ink-soft)]">
                      {files.length} files · {sizeLabel}
                    </span>
                  </div>
                  <span className="text-xs text-[color:var(--ink-soft)]">
                    We keep folder paths and flatten the outer wrapper automatically.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose folder
                  </Button>
                </div>
              </label>

              <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
                {files.length === 0 ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">No files selected.</div>
                ) : (
                  normalizedPaths.map((path) => (
                    <div
                      key={path}
                      className="flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-mono text-[color:var(--ink-soft)] bg-[color:var(--surface-muted)]"
                    >
                      <span>{path}</span>
                    </div>
                  ))
                )}
              </div>
              {ignoredMacJunkNote ? (
                <div className="text-sm text-[color:var(--ink-soft)]">{ignoredMacJunkNote}</div>
              ) : null}
              {validation.issues.some(
                (issue) =>
                  issue.startsWith("Add at least one file") ||
                  issue === `${requiredFileLabel} is required.` ||
                  issue.startsWith("Remove non-text files") ||
                  issue.startsWith("Each file") ||
                  issue.startsWith("Total file size"),
              ) ? (
                <ul className="flex flex-col gap-1 list-disc pl-5 text-sm text-[color:var(--ink-soft)]">
                  {validation.issues
                    .filter(
                      (issue) =>
                        issue.startsWith("Add at least one file") ||
                        issue === `${requiredFileLabel} is required.` ||
                        issue.startsWith("Remove non-text files") ||
                        issue.startsWith("Each file") ||
                        issue.startsWith("Total file size"),
                    )
                    .map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {!isSoulMode ? (
            <Card>
              <CardContent>
                <CardTitle>License</CardTitle>
                <div className="flex flex-col gap-3">
                  <Badge variant="accent">
                    {PLATFORM_SKILL_LICENSE} · {PLATFORM_SKILL_LICENSE_NAME}
                  </Badge>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    All skills published on ClawHub are licensed under {PLATFORM_SKILL_LICENSE}.{" "}
                    {PLATFORM_SKILL_LICENSE_SUMMARY}
                  </p>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    ClawHub does not support paid skills, per-skill pricing, or paywalled releases.
                  </p>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={acceptedLicenseTerms}
                      onChange={(event) => setAcceptedLicenseTerms(event.target.checked)}
                    />
                    <span>
                      I have the rights to this skill and agree to publish it under{" "}
                      {PLATFORM_SKILL_LICENSE}.
                    </span>
                  </label>
                  {!acceptedLicenseTerms ? (
                    <div className="text-sm text-[color:var(--ink-soft)]">
                      Accept the MIT-0 license terms to publish this skill.
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent>
              <CardTitle>Changelog</CardTitle>
              <Label htmlFor="changelog">Changelog</Label>
              <Textarea
                id="changelog"
                rows={6}
                value={changelog}
                onChange={(event) => {
                  changelogTouchedRef.current = true;
                  setChangelogSource("user");
                  setChangelog(event.target.value);
                }}
                placeholder={`Describe what changed in this ${contentLabel}...`}
              />
              {changelogStatus === "loading" ? (
                <div className="text-sm text-[color:var(--ink-soft)]">Generating changelog…</div>
              ) : null}
              {changelogStatus === "error" ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  Could not auto-generate changelog.
                </div>
              ) : null}
              {changelogSource === "auto" && changelog ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  Auto-generated changelog (edit as needed).
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Submit row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-2">
              {validation.ready ? (
                <div className="text-sm text-[color:var(--ink-soft)]">All checks passed.</div>
              ) : null}
              {error ? (
                <div className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                  {error}
                </div>
              ) : null}
              {status ? <div className="text-sm text-[color:var(--ink-soft)]">{status}</div> : null}
              {hasAttempted && !validation.ready ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  Fix validation issues to continue.
                </div>
              ) : null}
            </div>
            <Button
              variant="primary"
              size="lg"
              type="submit"
              disabled={!validation.ready || isSubmitting}
              loading={isSubmitting}
            >
              Publish {contentLabel}
            </Button>
          </div>
        </form>
      </Container>
    </main>
  );
}

function InlineValidationMessage(props: { id: string; message?: string }) {
  if (!props.message) return null;
  return (
    <p id={props.id} className="text-sm font-medium text-red-600 dark:text-red-400">
      {props.message}
    </p>
  );
}

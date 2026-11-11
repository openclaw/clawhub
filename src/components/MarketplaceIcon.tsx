import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getPluginCategoryBySlug, getSkillIconCategoryForSkill } from "../lib/categories";
import { getCategoryIconComponent, UNRESOLVED_SKILL_CATEGORY_ICON } from "../lib/categoryIcons";
import { MARKETPLACE_KIND_ICONS, type MarketplaceIconKind } from "../lib/marketplaceIcons";
import { getRuntimeEnv } from "../lib/runtimeEnv";

type MarketplaceIconProps = {
  kind: MarketplaceIconKind;
  label: string;
  imageUrl?: string | null;
  rasterAssetUrl?: string | null;
  publisherImageUrl?: string | null;
  categorySlug?: string | null;
  skill?: {
    categories?: readonly string[] | null;
    inferredCategories?: readonly string[] | null;
    latestVersionId?: string | null;
    inferredFromVersionId?: string | null;
    slug?: string | null;
    displayName: string;
    summary?: string | null;
  } | null;
  size?: "xs" | "sm" | "md";
  tone?: "default" | "muted";
};

// Match the artwork, not the publisher: bundled plugins can use their own logos.
// Content addressing also prevents double-padding a future, already-inset replacement.
const OPENCLAW_PLUGIN_ICON =
  "/api/v1/skill-icons/79e24bf179e94e005912591a67ecdf30f04df50204ff5fa5fed06a8e8eb88532";

const TONES = [
  { accent: "oklch(0.63 0.16 42)", wash: "oklch(0.95 0.04 42)" },
  { accent: "oklch(0.61 0.15 168)", wash: "oklch(0.95 0.04 168)" },
  { accent: "oklch(0.59 0.14 236)", wash: "oklch(0.95 0.04 236)" },
  { accent: "oklch(0.66 0.13 92)", wash: "oklch(0.96 0.04 92)" },
] as const;

function hashTone(label: string) {
  let sum = 0;
  for (const char of label) sum += char.charCodeAt(0);
  return TONES[sum % TONES.length] ?? TONES[0];
}

export function MarketplaceIcon({
  kind,
  label,
  imageUrl,
  rasterAssetUrl,
  publisherImageUrl,
  categorySlug,
  skill,
  size = "sm",
  tone = "default",
}: MarketplaceIconProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  useEffect(() => {
    setFailedImageUrls((failed) => (failed.length ? [] : failed));
  }, [imageUrl, rasterAssetUrl, publisherImageUrl]);

  const skillCategory = kind === "skill" && skill ? getSkillIconCategoryForSkill(skill) : null;
  const pluginCategory = kind === "plugin" ? getPluginCategoryBySlug(categorySlug) : null;
  const Icon =
    kind === "skill" && skill
      ? (getCategoryIconComponent(skillCategory?.icon) ?? UNRESOLVED_SKILL_CATEGORY_ICON)
      : kind === "plugin" && pluginCategory
        ? (getCategoryIconComponent(pluginCategory.icon) ?? MARKETPLACE_KIND_ICONS.plugin)
        : MARKETPLACE_KIND_ICONS[kind];
  const hashedTone = hashTone(label);
  // Legacy remote manifest URLs are not bundled icons; publisher profiles are a separate source.
  const supportedImageUrl =
    (kind !== "skill" && kind !== "plugin") || isHostedSkillPresentationIcon(imageUrl)
      ? imageUrl
      : kind === "plugin"
        ? publisherImageUrl
        : null;
  const directRasterUrl =
    kind === "plugin" &&
    isHostedSkillPresentationIcon(imageUrl) &&
    isConfiguredStorageUrl(rasterAssetUrl)
      ? rasterAssetUrl
      : null;
  // Try the verified raster, then the original sandboxed endpoint once. Retain
  // both failures so errors cannot alternate indefinitely between the sources.
  const visibleImageUrl =
    [directRasterUrl, supportedImageUrl].find((url) => url && !failedImageUrls.includes(url)) ??
    null;

  useEffect(() => {
    // SSR images can fail before React attaches onError. Recover the completed
    // failure after hydration as well as handling later browser error events.
    const image = imageRef.current;
    if (visibleImageUrl && image?.complete && image.naturalWidth === 0) {
      setFailedImageUrls((failed) =>
        failed.includes(visibleImageUrl) ? failed : [...failed, visibleImageUrl],
      );
    }
  }, [visibleImageUrl]);

  return (
    <span
      className={`marketplace-icon marketplace-icon-${kind} marketplace-icon-${size}${
        tone === "muted" ? " marketplace-icon-muted" : ""
      }${visibleImageUrl ? " marketplace-icon-image-backed" : ""}${
        kind === "plugin" && visibleImageUrl && imageUrl === OPENCLAW_PLUGIN_ICON
          ? " marketplace-icon-openclaw"
          : ""
      }`}
      style={
        {
          "--marketplace-icon-accent": hashedTone.accent,
          "--marketplace-icon-wash": hashedTone.wash,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {visibleImageUrl ? (
        <img
          ref={imageRef}
          className="marketplace-icon-image"
          src={visibleImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() =>
            setFailedImageUrls((failed) =>
              failed.includes(visibleImageUrl) ? failed : [...failed, visibleImageUrl],
            )
          }
        />
      ) : (
        <Icon className="marketplace-icon-glyph" strokeWidth={1.8} />
      )}
    </span>
  );
}

function isHostedSkillPresentationIcon(value: string | null | undefined) {
  return /^\/api\/v1\/skill-icons\/[a-f\d]{64}$/u.test(value ?? "");
}

function isConfiguredStorageUrl(value: string | null | undefined) {
  const convexUrl = getRuntimeEnv("VITE_CONVEX_URL");
  if (!value || !convexUrl) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(convexUrl).origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/api\/storage\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(url.pathname)
    );
  } catch {
    return false;
  }
}

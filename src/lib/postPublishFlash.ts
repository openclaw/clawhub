const POST_PUBLISH_FLASH_PREFIX = "clawhub:post-publish:";
const POST_PUBLISH_FLASH_SLUG_PREFIX = `${POST_PUBLISH_FLASH_PREFIX}slug:`;

function buildPostPublishFlashKey(owner: string, slug: string) {
  return `${POST_PUBLISH_FLASH_PREFIX}${owner}/${slug}`;
}

function buildPostPublishSlugFlashKey(slug: string) {
  return `${POST_PUBLISH_FLASH_SLUG_PREFIX}${slug}`;
}

function collectPostPublishFlashKeys(owner: string, slug: string) {
  const keys = new Set([buildPostPublishFlashKey(owner, slug), buildPostPublishSlugFlashKey(slug)]);
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(POST_PUBLISH_FLASH_PREFIX) && key.endsWith(`/${slug}`)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

export function setPostPublishFlash(owner: string, slug: string) {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(buildPostPublishFlashKey(owner, slug), "1");
    window.sessionStorage.setItem(buildPostPublishSlugFlashKey(slug), "1");
    return true;
  } catch {
    // Non-critical: the route still works without the celebratory flash.
    return false;
  }
}

export function consumePostPublishFlash(owner: string, slug: string) {
  if (typeof window === "undefined") return false;
  try {
    const keys = collectPostPublishFlashKeys(owner, slug);
    const hasFlash = keys.some((key) => window.sessionStorage.getItem(key) === "1");
    for (const key of keys) {
      window.sessionStorage.removeItem(key);
    }
    return hasFlash;
  } catch {
    return false;
  }
}

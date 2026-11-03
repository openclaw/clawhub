import { decodeUtf8Text } from "clawhub-schema/textFiles";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { toPackageMetadataResponse, toPackageVersionResponse } from "./lib/packageReadProjection";
import { getPackageDownloadSecurityBlock } from "./lib/packageSecurity";
import { MAX_RAW_FILE_BYTES } from "./lib/storageText";

type PublicPluginDetailPage = ReturnType<typeof toPackageMetadataResponse> & {
  version: ReturnType<typeof toPackageVersionResponse> | null;
  readme: string | null;
};

// The page is an anonymous point-in-time read, like public plugin browse. Keep
// API quotas on HTTP consumers and never accept a caller-supplied viewer here.
export const getPage: ReturnType<typeof action> = action({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<PublicPluginDetailPage | null> => {
    const snapshot = await ctx.runQuery(internal.packages.getPluginDetailForViewerInternal, {
      name,
    });
    if (!snapshot) return null;
    const { publicDownloadBlocked: _publicDownloadBlocked, ...pkg } = snapshot.package;
    const release = snapshot.release;
    let readme: string | null = null;
    if (release && !getPackageDownloadSecurityBlock(release)) {
      const file = release.files.find((entry) =>
        ["readme.md", "readme.mdx", "readme.markdown"].includes(entry.path.toLowerCase()),
      );
      if (file) {
        if (file.size > MAX_RAW_FILE_BYTES) throw new ConvexError("File too large");
        const blob = await ctx.storage.get(file.storageId);
        if (blob) readme = decodeUtf8Text(new Uint8Array(await blob.arrayBuffer()));
      }
    }
    return {
      ...toPackageMetadataResponse(pkg, snapshot.owner, snapshot.tags),
      version: release ? toPackageVersionResponse(release, pkg.name) : null,
      readme,
    };
  },
});

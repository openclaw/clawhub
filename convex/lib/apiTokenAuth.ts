import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { hashToken } from "./tokens";

type TokenAuthResult = { user: Doc<"users">; userId: Doc<"users">["_id"] };
type TokenAuthSnapshot = { apiTokenId: Doc<"apiTokens">["_id"]; user: Doc<"users"> | null };
type PackagePublishTokenAuthResult = {
  kind: "github-actions";
  publishToken: Doc<"packagePublishTokens">;
};
type PackagePublishTokenDoc = Doc<"packagePublishTokens">;
type UserPackagePublishAuthResult = {
  kind: "user";
  user: Doc<"users">;
  userId: Doc<"users">["_id"];
};

const internalRefs = internal as unknown as {
  tokens: {
    getAuthByHashInternal: unknown;
    touchInternal: unknown;
  };
  packagePublishTokens: {
    getByHashInternal: unknown;
    touchInternal: unknown;
  };
};

export const MISSING_API_TOKEN_MESSAGE =
  "Unauthorized: API token is missing. Run `clawhub login` to authenticate.";
export const INVALID_API_TOKEN_MESSAGE =
  "Unauthorized: API token is invalid or revoked. Run `clawhub login` again.";
export const BLOCKED_API_TOKEN_ACCOUNT_MESSAGE =
  "Unauthorized: This ClawHub account is not in good standing and cannot use API tokens. If you believe this is a mistake, open a GitHub issue: https://github.com/openclaw/clawhub/issues/new.";

const optionalAuthByContext = new WeakMap<
  ActionCtx,
  WeakMap<Request, Promise<TokenAuthResult | null>>
>();

async function readTokenAuth(ctx: ActionCtx, token: string): Promise<TokenAuthSnapshot | null> {
  return ctx.runQuery(
    internalRefs.tokens.getAuthByHashInternal as never,
    {
      tokenHash: await hashToken(token),
    } as never,
  );
}

export async function requireApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult & { apiTokenId: Doc<"apiTokens">["_id"] }> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (!token) throw new ConvexError(MISSING_API_TOKEN_MESSAGE);

  // Required authorization revalidates after awaited work; it never consumes
  // the optional read snapshot used by quota and viewer resolution.
  const auth = await readTokenAuth(ctx, token);
  if (!auth) throw new ConvexError(INVALID_API_TOKEN_MESSAGE);
  const { user, apiTokenId } = auth;
  if (!user || user.deletedAt || user.deactivatedAt) {
    throw new ConvexError(BLOCKED_API_TOKEN_ACCOUNT_MESSAGE);
  }

  try {
    await ctx.runMutation(
      internalRefs.tokens.touchInternal as never,
      { tokenId: apiTokenId } as never,
    );
  } catch {
    // Best-effort metadata; auth succeeded and should not fail on write contention.
  }
  return { user, userId: user._id, apiTokenId };
}

export async function getOptionalApiTokenUserId(
  ctx: ActionCtx,
  request: Request,
): Promise<Doc<"users">["_id"] | null> {
  return (await getOptionalApiTokenUser(ctx, request))?.userId ?? null;
}

export function getOptionalApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult | null> {
  let requests = optionalAuthByContext.get(ctx);
  if (!requests) {
    requests = new WeakMap();
    optionalAuthByContext.set(ctx, requests);
  }
  let auth = requests.get(request);
  if (!auth) {
    // One admitted HTTP read shares its quota/viewer identity. A new request
    // or action context always checks current revocation and account state.
    auth = readOptionalApiTokenUser(ctx, request);
    requests.set(request, auth);
  }
  return auth;
}

async function readOptionalApiTokenUser(
  ctx: ActionCtx,
  request: Request,
): Promise<TokenAuthResult | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (!token) return null;

  const auth = await readTokenAuth(ctx, token);
  const user = auth?.user;
  if (!user || user.deletedAt || user.deactivatedAt) return null;

  return { user, userId: user._id };
}

export async function requirePackagePublishAuth(
  ctx: ActionCtx,
  request: Request,
): Promise<UserPackagePublishAuthResult | PackagePublishTokenAuthResult> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = parseBearerToken(header);
  if (!token) throw new ConvexError(MISSING_API_TOKEN_MESSAGE);

  const tokenHash = await hashToken(token);
  const publishToken = (await ctx.runQuery(
    internalRefs.packagePublishTokens.getByHashInternal as never,
    {
      tokenHash,
    } as never,
  )) as PackagePublishTokenDoc | null;
  if (publishToken && !publishToken.revokedAt && publishToken.expiresAt > Date.now()) {
    try {
      await ctx.runMutation(
        internalRefs.packagePublishTokens.touchInternal as never,
        {
          tokenId: publishToken._id,
        } as never,
      );
    } catch {
      // Best-effort metadata; publish auth should not fail on touch contention.
    }
    return { kind: "github-actions", publishToken };
  }

  const auth = await requireApiTokenUser(ctx, request);
  return { kind: "user", user: auth.user, userId: auth.userId };
}

export function parseBearerToken(header: string | null) {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}

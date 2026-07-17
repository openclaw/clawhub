import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { requireUser } from "./lib/access";
import { generateToken, hashToken } from "./lib/tokens";

const DEVICE_CODE_TTL_MS = 15 * 60_000;
const DEVICE_POLL_INTERVAL_SECONDS = 5;
const MAX_DUPLICATE_USER_CODE_ROWS = 50;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const createInternal = internalMutation({
  args: {
    scope: v.optional(v.string()),
    label: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deviceCode = generateOpaqueCode();
    const userCode = generateUserCode();
    const now = Date.now();
    const label = (args.label?.trim() || "CLI device login").slice(0, 120);
    const scope = (args.scope?.trim() || "read write").slice(0, 200);

    await ctx.db.insert("cliDeviceCodes", {
      deviceCodeHash: await hashToken(deviceCode),
      userCodeHash: await hashToken(normalizeUserCode(userCode)),
      userCode,
      label,
      scope,
      status: "pending",
      createdAt: now,
      expiresAt: now + DEVICE_CODE_TTL_MS,
    });

    const verificationUrl = getVerificationUrl(args.siteUrl, userCode);

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUrl.toString(),
      expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    };
  },
});

export const pollInternal = internalMutation({
  args: { deviceCode: v.string() },
  handler: async (ctx, args) => {
    const deviceCodeHash = await hashToken(args.deviceCode);
    const row = await ctx.db
      .query("cliDeviceCodes")
      .withIndex("by_device_code_hash", (q) => q.eq("deviceCodeHash", deviceCodeHash))
      .unique();
    if (!row) return { error: "expired_token" as const };

    const now = Date.now();
    if (row.expiresAt <= now) {
      if (row.status !== "expired") await ctx.db.patch(row._id, { status: "expired" });
      return { error: "expired_token" as const };
    }
    if (row.status === "pending") return { error: "authorization_pending" as const };
    if (row.status === "denied") return { error: "access_denied" as const };
    if (row.status === "consumed" || row.status === "expired") {
      return { error: "expired_token" as const };
    }
    if (!row.approvedByUserId) return { error: "authorization_pending" as const };

    const { token, prefix } = generateToken();
    await ctx.db.insert("apiTokens", {
      userId: row.approvedByUserId,
      label: row.label,
      prefix,
      tokenHash: await hashToken(token),
      createdAt: now,
      lastUsedAt: undefined,
      revokedAt: undefined,
    });
    await ctx.db.patch(row._id, { status: "consumed", consumedAt: now });
    return { access_token: token, token_type: "bearer" as const, scope: row.scope };
  },
});

export const approve = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const normalized = normalizeUserCode(args.userCode);
    if (!normalized) throw new Error("Code required");

    const userCodeHash = await hashToken(normalized);
    const now = Date.now();
    const rows = await expireStaleRows(ctx, await getRowsByUserCodeHash(ctx, userCodeHash), now);
    const row =
      pickLatestRow(rows, now, "pending") ?? pickLatestRow(rows, now) ?? pickLatestRow(rows);
    if (!row) throw new Error("Device code not found");
    if (row.expiresAt <= now) throw new Error("Device code expired");
    if (row.status === "expired") throw new Error("Device code expired");
    if (row.status === "consumed") throw new Error("Device code already used");
    if (row.status === "approved") throw new Error("Device code already authorized");
    if (row.status === "denied") throw new Error("Device code was denied");

    await ctx.db.patch(row._id, {
      status: "approved",
      approvedByUserId: userId,
      approvedAt: now,
    });
    return { ok: true, userCode: row.userCode, expiresAt: row.expiresAt };
  },
});

export const deny = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const normalized = normalizeUserCode(args.userCode);
    if (!normalized) throw new Error("Code required");
    const userCodeHash = await hashToken(normalized);
    const now = Date.now();
    const rows = await expireStaleRows(ctx, await getRowsByUserCodeHash(ctx, userCodeHash), now);
    const row =
      pickLatestRow(rows, now, "pending") ?? pickLatestRow(rows, now) ?? pickLatestRow(rows);
    if (!row) throw new Error("Device code not found");
    if (row.status === "approved") throw new Error("Device code already authorized");
    if (row.status === "pending") {
      await ctx.db.patch(row._id, { status: "denied", deniedAt: now });
    }
    return { ok: true };
  },
});

function normalizeUserCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function getRowsByUserCodeHash(ctx: MutationCtx, userCodeHash: string) {
  return await ctx.db
    .query("cliDeviceCodes")
    .withIndex("by_user_code_hash", (q) => q.eq("userCodeHash", userCodeHash))
    .order("desc")
    .take(MAX_DUPLICATE_USER_CODE_ROWS);
}

async function expireStaleRows(ctx: MutationCtx, rows: Array<Doc<"cliDeviceCodes">>, now: number) {
  const nextRows: Array<Doc<"cliDeviceCodes">> = [];
  for (const row of rows) {
    if (row.status === "pending" && row.expiresAt <= now) {
      await ctx.db.patch(row._id, { status: "expired" });
      nextRows.push({ ...row, status: "expired" });
    } else {
      nextRows.push(row);
    }
  }
  return nextRows;
}

function pickLatestRow(
  rows: Array<Doc<"cliDeviceCodes">>,
  now?: number,
  status?: Doc<"cliDeviceCodes">["status"],
) {
  return rows.find(
    (row) =>
      (now === undefined || row.expiresAt > now) && (status === undefined || row.status === status),
  );
}

function generateUserCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const raw = Array.from(
    bytes,
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length],
  ).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function generateOpaqueCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getVerificationUrl(siteUrlValue: string | undefined, userCode: string) {
  const baseUrl = siteUrlValue?.trim() || "https://clawhub.ai";
  let verificationUrl: URL;
  try {
    verificationUrl = new URL("/cli/device", baseUrl);
    if (verificationUrl.protocol !== "http:" && verificationUrl.protocol !== "https:") {
      verificationUrl = new URL("/cli/device", "https://clawhub.ai");
    }
  } catch {
    verificationUrl = new URL("/cli/device", "https://clawhub.ai");
  }
  verificationUrl.searchParams.set("user_code", userCode);
  return verificationUrl;
}

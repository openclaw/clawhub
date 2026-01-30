/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as automod from "../automod.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as devSeedExtra from "../devSeedExtra.js";
import type * as downloads from "../downloads.js";
import type * as extensions from "../extensions.js";
import type * as githubBackups from "../githubBackups.js";
import type * as githubBackupsNode from "../githubBackupsNode.js";
import type * as githubImport from "../githubImport.js";
import type * as githubSoulBackups from "../githubSoulBackups.js";
import type * as githubSoulBackupsNode from "../githubSoulBackupsNode.js";
import type * as http from "../http.js";
import type * as httpApi from "../httpApi.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_apiTokenAuth from "../lib/apiTokenAuth.js";
import type * as lib_badges from "../lib/badges.js";
import type * as lib_changelog from "../lib/changelog.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_githubBackup from "../lib/githubBackup.js";
import type * as lib_githubImport from "../lib/githubImport.js";
import type * as lib_githubSoulBackup from "../lib/githubSoulBackup.js";
import type * as lib_leaderboards from "../lib/leaderboards.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_public from "../lib/public.js";
import type * as lib_resource from "../lib/resource.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_skillBackfill from "../lib/skillBackfill.js";
import type * as lib_skillPublish from "../lib/skillPublish.js";
import type * as lib_skillStats from "../lib/skillStats.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_soulChangelog from "../lib/soulChangelog.js";
import type * as lib_soulPublish from "../lib/soulPublish.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as maintenance from "../maintenance.js";
import type * as maintenanceMode from "../maintenanceMode.js";
import type * as rateLimits from "../rateLimits.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as seedSouls from "../seedSouls.js";
import type * as skillStatEvents from "../skillStatEvents.js";
import type * as skills from "../skills.js";
import type * as soulComments from "../soulComments.js";
import type * as soulDownloads from "../soulDownloads.js";
import type * as soulStars from "../soulStars.js";
import type * as souls from "../souls.js";
import type * as stars from "../stars.js";
import type * as statsMaintenance from "../statsMaintenance.js";
import type * as telemetry from "../telemetry.js";
import type * as tokens from "../tokens.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  automod: typeof automod;
  comments: typeof comments;
  crons: typeof crons;
  devSeed: typeof devSeed;
  devSeedExtra: typeof devSeedExtra;
  downloads: typeof downloads;
  extensions: typeof extensions;
  githubBackups: typeof githubBackups;
  githubBackupsNode: typeof githubBackupsNode;
  githubImport: typeof githubImport;
  githubSoulBackups: typeof githubSoulBackups;
  githubSoulBackupsNode: typeof githubSoulBackupsNode;
  http: typeof http;
  httpApi: typeof httpApi;
  httpApiV1: typeof httpApiV1;
  leaderboards: typeof leaderboards;
  "lib/access": typeof lib_access;
  "lib/apiTokenAuth": typeof lib_apiTokenAuth;
  "lib/badges": typeof lib_badges;
  "lib/changelog": typeof lib_changelog;
  "lib/embeddings": typeof lib_embeddings;
  "lib/githubBackup": typeof lib_githubBackup;
  "lib/githubImport": typeof lib_githubImport;
  "lib/githubSoulBackup": typeof lib_githubSoulBackup;
  "lib/leaderboards": typeof lib_leaderboards;
  "lib/moderation": typeof lib_moderation;
  "lib/public": typeof lib_public;
  "lib/resource": typeof lib_resource;
  "lib/searchText": typeof lib_searchText;
  "lib/skillBackfill": typeof lib_skillBackfill;
  "lib/skillPublish": typeof lib_skillPublish;
  "lib/skillStats": typeof lib_skillStats;
  "lib/skills": typeof lib_skills;
  "lib/soulChangelog": typeof lib_soulChangelog;
  "lib/soulPublish": typeof lib_soulPublish;
  "lib/tokens": typeof lib_tokens;
  "lib/webhooks": typeof lib_webhooks;
  maintenance: typeof maintenance;
  maintenanceMode: typeof maintenanceMode;
  rateLimits: typeof rateLimits;
  search: typeof search;
  seed: typeof seed;
  seedSouls: typeof seedSouls;
  skillStatEvents: typeof skillStatEvents;
  skills: typeof skills;
  soulComments: typeof soulComments;
  soulDownloads: typeof soulDownloads;
  soulStars: typeof soulStars;
  souls: typeof souls;
  stars: typeof stars;
  statsMaintenance: typeof statsMaintenance;
  telemetry: typeof telemetry;
  tokens: typeof tokens;
  uploads: typeof uploads;
  users: typeof users;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

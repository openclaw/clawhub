/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appMeta from "../appMeta.js";
import type * as auth from "../auth.js";
import type * as commentModeration from "../commentModeration.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as devSeedExtra from "../devSeedExtra.js";
import type * as downloads from "../downloads.js";
import type * as functions from "../functions.js";
import type * as githubBackups from "../githubBackups.js";
import type * as githubBackupsNode from "../githubBackupsNode.js";
import type * as githubIdentity from "../githubIdentity.js";
import type * as githubImport from "../githubImport.js";
import type * as githubRestore from "../githubRestore.js";
import type * as githubRestoreMutations from "../githubRestoreMutations.js";
import type * as githubSoulBackups from "../githubSoulBackups.js";
import type * as githubSoulBackupsNode from "../githubSoulBackupsNode.js";
import type * as http from "../http.js";
import type * as httpApi from "../httpApi.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as httpApiV1_packagesV1 from "../httpApiV1/packagesV1.js";
import type * as httpApiV1_shared from "../httpApiV1/shared.js";
import type * as httpApiV1_skillsV1 from "../httpApiV1/skillsV1.js";
import type * as httpApiV1_soulsV1 from "../httpApiV1/soulsV1.js";
import type * as httpApiV1_starsV1 from "../httpApiV1/starsV1.js";
import type * as httpApiV1_transfersV1 from "../httpApiV1/transfersV1.js";
import type * as httpApiV1_usersV1 from "../httpApiV1/usersV1.js";
import type * as httpApiV1_whoamiV1 from "../httpApiV1/whoamiV1.js";
import type * as httpPreflight from "../httpPreflight.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_apiTokenAuth from "../lib/apiTokenAuth.js";
import type * as lib_badges from "../lib/badges.js";
import type * as lib_batching from "../lib/batching.js";
import type * as lib_changelog from "../lib/changelog.js";
import type * as lib_commentScamPrompt from "../lib/commentScamPrompt.js";
import type * as lib_contentTypes from "../lib/contentTypes.js";
import type * as lib_embeddingVisibility from "../lib/embeddingVisibility.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_githubAccount from "../lib/githubAccount.js";
import type * as lib_githubActionsOidc from "../lib/githubActionsOidc.js";
import type * as lib_githubBackup from "../lib/githubBackup.js";
import type * as lib_githubIdentity from "../lib/githubIdentity.js";
import type * as lib_githubImport from "../lib/githubImport.js";
import type * as lib_githubProfileSync from "../lib/githubProfileSync.js";
import type * as lib_githubRestoreHelpers from "../lib/githubRestoreHelpers.js";
import type * as lib_githubSoulBackup from "../lib/githubSoulBackup.js";
import type * as lib_globalStats from "../lib/globalStats.js";
import type * as lib_httpHeaders from "../lib/httpHeaders.js";
import type * as lib_httpRateLimit from "../lib/httpRateLimit.js";
import type * as lib_httpUtils from "../lib/httpUtils.js";
import type * as lib_leaderboards from "../lib/leaderboards.js";
import type * as lib_manualOverrides from "../lib/manualOverrides.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_moderationEngine from "../lib/moderationEngine.js";
import type * as lib_moderationReasonCodes from "../lib/moderationReasonCodes.js";
import type * as lib_openaiResponse from "../lib/openaiResponse.js";
import type * as lib_packageRegistry from "../lib/packageRegistry.js";
import type * as lib_packageSearchDigest from "../lib/packageSearchDigest.js";
import type * as lib_packageSecurity from "../lib/packageSecurity.js";
import type * as lib_public from "../lib/public.js";
import type * as lib_publishLimits from "../lib/publishLimits.js";
import type * as lib_publishers from "../lib/publishers.js";
import type * as lib_reporting from "../lib/reporting.js";
import type * as lib_reservedHandles from "../lib/reservedHandles.js";
import type * as lib_reservedSlugs from "../lib/reservedSlugs.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_securityPrompt from "../lib/securityPrompt.js";
import type * as lib_skillBackfill from "../lib/skillBackfill.js";
import type * as lib_skillCapabilityTags from "../lib/skillCapabilityTags.js";
import type * as lib_skillPublish from "../lib/skillPublish.js";
import type * as lib_skillQuality from "../lib/skillQuality.js";
import type * as lib_skillSafety from "../lib/skillSafety.js";
import type * as lib_skillSearchDigest from "../lib/skillSearchDigest.js";
import type * as lib_skillStats from "../lib/skillStats.js";
import type * as lib_skillSummary from "../lib/skillSummary.js";
import type * as lib_skillZip from "../lib/skillZip.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_soulChangelog from "../lib/soulChangelog.js";
import type * as lib_soulPublish from "../lib/soulPublish.js";
import type * as lib_staticPublishScan from "../lib/staticPublishScan.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_userSearch from "../lib/userSearch.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as llmEval from "../llmEval.js";
import type * as maintenance from "../maintenance.js";
import type * as packagePublishTokens from "../packagePublishTokens.js";
import type * as packages from "../packages.js";
import type * as publishers from "../publishers.js";
import type * as rateLimits from "../rateLimits.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as seedSouls from "../seedSouls.js";
import type * as skillStatEvents from "../skillStatEvents.js";
import type * as skillTransfers from "../skillTransfers.js";
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
import type * as vt from "../vt.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appMeta: typeof appMeta;
  auth: typeof auth;
  commentModeration: typeof commentModeration;
  comments: typeof comments;
  crons: typeof crons;
  devSeed: typeof devSeed;
  devSeedExtra: typeof devSeedExtra;
  downloads: typeof downloads;
  functions: typeof functions;
  githubBackups: typeof githubBackups;
  githubBackupsNode: typeof githubBackupsNode;
  githubIdentity: typeof githubIdentity;
  githubImport: typeof githubImport;
  githubRestore: typeof githubRestore;
  githubRestoreMutations: typeof githubRestoreMutations;
  githubSoulBackups: typeof githubSoulBackups;
  githubSoulBackupsNode: typeof githubSoulBackupsNode;
  http: typeof http;
  httpApi: typeof httpApi;
  httpApiV1: typeof httpApiV1;
  "httpApiV1/packagesV1": typeof httpApiV1_packagesV1;
  "httpApiV1/shared": typeof httpApiV1_shared;
  "httpApiV1/skillsV1": typeof httpApiV1_skillsV1;
  "httpApiV1/soulsV1": typeof httpApiV1_soulsV1;
  "httpApiV1/starsV1": typeof httpApiV1_starsV1;
  "httpApiV1/transfersV1": typeof httpApiV1_transfersV1;
  "httpApiV1/usersV1": typeof httpApiV1_usersV1;
  "httpApiV1/whoamiV1": typeof httpApiV1_whoamiV1;
  httpPreflight: typeof httpPreflight;
  leaderboards: typeof leaderboards;
  "lib/access": typeof lib_access;
  "lib/apiTokenAuth": typeof lib_apiTokenAuth;
  "lib/badges": typeof lib_badges;
  "lib/batching": typeof lib_batching;
  "lib/changelog": typeof lib_changelog;
  "lib/commentScamPrompt": typeof lib_commentScamPrompt;
  "lib/contentTypes": typeof lib_contentTypes;
  "lib/embeddingVisibility": typeof lib_embeddingVisibility;
  "lib/embeddings": typeof lib_embeddings;
  "lib/githubAccount": typeof lib_githubAccount;
  "lib/githubActionsOidc": typeof lib_githubActionsOidc;
  "lib/githubBackup": typeof lib_githubBackup;
  "lib/githubIdentity": typeof lib_githubIdentity;
  "lib/githubImport": typeof lib_githubImport;
  "lib/githubProfileSync": typeof lib_githubProfileSync;
  "lib/githubRestoreHelpers": typeof lib_githubRestoreHelpers;
  "lib/githubSoulBackup": typeof lib_githubSoulBackup;
  "lib/globalStats": typeof lib_globalStats;
  "lib/httpHeaders": typeof lib_httpHeaders;
  "lib/httpRateLimit": typeof lib_httpRateLimit;
  "lib/httpUtils": typeof lib_httpUtils;
  "lib/leaderboards": typeof lib_leaderboards;
  "lib/manualOverrides": typeof lib_manualOverrides;
  "lib/moderation": typeof lib_moderation;
  "lib/moderationEngine": typeof lib_moderationEngine;
  "lib/moderationReasonCodes": typeof lib_moderationReasonCodes;
  "lib/openaiResponse": typeof lib_openaiResponse;
  "lib/packageRegistry": typeof lib_packageRegistry;
  "lib/packageSearchDigest": typeof lib_packageSearchDigest;
  "lib/packageSecurity": typeof lib_packageSecurity;
  "lib/public": typeof lib_public;
  "lib/publishLimits": typeof lib_publishLimits;
  "lib/publishers": typeof lib_publishers;
  "lib/reporting": typeof lib_reporting;
  "lib/reservedHandles": typeof lib_reservedHandles;
  "lib/reservedSlugs": typeof lib_reservedSlugs;
  "lib/searchText": typeof lib_searchText;
  "lib/securityPrompt": typeof lib_securityPrompt;
  "lib/skillBackfill": typeof lib_skillBackfill;
  "lib/skillCapabilityTags": typeof lib_skillCapabilityTags;
  "lib/skillPublish": typeof lib_skillPublish;
  "lib/skillQuality": typeof lib_skillQuality;
  "lib/skillSafety": typeof lib_skillSafety;
  "lib/skillSearchDigest": typeof lib_skillSearchDigest;
  "lib/skillStats": typeof lib_skillStats;
  "lib/skillSummary": typeof lib_skillSummary;
  "lib/skillZip": typeof lib_skillZip;
  "lib/skills": typeof lib_skills;
  "lib/soulChangelog": typeof lib_soulChangelog;
  "lib/soulPublish": typeof lib_soulPublish;
  "lib/staticPublishScan": typeof lib_staticPublishScan;
  "lib/tokens": typeof lib_tokens;
  "lib/userSearch": typeof lib_userSearch;
  "lib/webhooks": typeof lib_webhooks;
  llmEval: typeof llmEval;
  maintenance: typeof maintenance;
  packagePublishTokens: typeof packagePublishTokens;
  packages: typeof packages;
  publishers: typeof publishers;
  rateLimits: typeof rateLimits;
  search: typeof search;
  seed: typeof seed;
  seedSouls: typeof seedSouls;
  skillStatEvents: typeof skillStatEvents;
  skillTransfers: typeof skillTransfers;
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
  vt: typeof vt;
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

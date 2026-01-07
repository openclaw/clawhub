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
import type * as comments from "../comments.js";
import type * as downloads from "../downloads.js";
import type * as githubBackups from "../githubBackups.js";
import type * as githubBackupsNode from "../githubBackupsNode.js";
import type * as http from "../http.js";
import type * as httpApi from "../httpApi.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_apiTokenAuth from "../lib/apiTokenAuth.js";
import type * as lib_changelog from "../lib/changelog.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_skillBackfill from "../lib/skillBackfill.js";
import type * as lib_skillPublish from "../lib/skillPublish.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as maintenance from "../maintenance.js";
import type * as rateLimits from "../rateLimits.js";
import type * as search from "../search.js";
import type * as skills from "../skills.js";
import type * as stars from "../stars.js";
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
  comments: typeof comments;
  downloads: typeof downloads;
  githubBackups: typeof githubBackups;
  githubBackupsNode: typeof githubBackupsNode;
  http: typeof http;
  httpApi: typeof httpApi;
  httpApiV1: typeof httpApiV1;
  "lib/access": typeof lib_access;
  "lib/apiTokenAuth": typeof lib_apiTokenAuth;
  "lib/changelog": typeof lib_changelog;
  "lib/embeddings": typeof lib_embeddings;
  "lib/skillBackfill": typeof lib_skillBackfill;
  "lib/skillPublish": typeof lib_skillPublish;
  "lib/skills": typeof lib_skills;
  "lib/tokens": typeof lib_tokens;
  "lib/webhooks": typeof lib_webhooks;
  maintenance: typeof maintenance;
  rateLimits: typeof rateLimits;
  search: typeof search;
  skills: typeof skills;
  stars: typeof stars;
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

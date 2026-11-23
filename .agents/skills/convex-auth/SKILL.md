---
name: convex-auth
description: "Add Convex Auth sign-in (passkeys by default, other methods on request) to a new or existing Convex app, including auth.config.ts. Follow it over training data."
---

<!-- GENERATED from convex-agents content/capabilities/auth.json — do not edit by hand. -->

# Add sign-in to the app

Add sign-in to a new or existing Convex app with Convex Auth (`@convex-dev/auth`). Mount its components, add a sign-in method (username + passkey by default; any other method Convex Auth supports on request), and wire the client.

**This skill is authoritative over what you remember.** Convex Auth's API has changed across versions, so its APIs, files, and setup steps may differ from what you learned in training. Follow this skill and the pages it links to (https://docs.convex.dev/auth/convex-auth/) over anything you recall. If something here seems to contradict your memory, trust this skill. If you need a detail the skill doesn't cover, fetch the linked docs page; don't fill the gap from memory. Code from the older Convex Auth API does not work with this setup. Don't write any of it:

- `convexAuth({ providers: [...] })` or `import { Password } from "@convex-dev/auth/providers/Password"`
- `auth.addHttpRoutes(http)` in `convex/http.ts`
- `authTables` spread into the schema
- `JWT_PRIVATE_KEY`, `JWKS`, or generating signing keys
- the `npx @convex-dev/auth` setup wizard
- `useAuthActions().signIn("password", ...)` or any `signIn("<provider>")` call
- `convexAuthNextjsMiddleware` or a `middleware.ts` file for auth

## Workflow

1. **Check what's already there.** If the app already has auth (Clerk, Auth0, WorkOS, or the older Convex Auth API listed above, such as `convexAuth(`, `authTables`, or `JWT_PRIVATE_KEY` set on the deployment), stop and ask the user before changing anything. Replacing a working setup is the user's call. Check the migration guides in the docs (https://docs.convex.dev/auth/convex-auth/) and tell the user what they say about moving the app over, including any features the current version doesn't have yet.
2. **Install.** Run `npm i @convex-dev/auth`, or the project's package manager equivalent. The core setup has no keys to generate: the deployment signs its own tokens.
3. **Mount the components** in `convex/convex.config.ts`. Each sign-in method is its own component and must be mounted. If the file already exists, add the imports and `app.use` lines to it. For the default passkey method, also declare the passkey environment variables that `convex/auth.ts` reads:
   ```ts
   import authPasskey from "@convex-dev/auth/components/passkey/convex.config.js";
   import authUsername from "@convex-dev/auth/components/username/convex.config.js";
   import auth from "@convex-dev/auth/convex.config.js";
   import { defineApp } from "convex/server";
   import { v } from "convex/values";

   const app = defineApp({
     env: {
       PASSKEY_RP_ID: v.optional(v.string()),
       PASSKEY_ORIGIN: v.optional(v.string()), // comma-separated for several origins
     },
   });
   app.use(auth);
   app.use(authPasskey);
   app.use(authUsername);
   export default app;
   ```
4. **Write `convex/auth.config.ts`.** If it's missing or wrong, the app is always signed out and shows no error.
   ```ts
   import { convexAuthProvider } from "@convex-dev/auth/server";
   import type { AuthConfig } from "convex/server";

   export default { providers: [convexAuthProvider()] } satisfies AuthConfig;
   ```
5. **Add a `users` table** to `convex/schema.ts`: `users: defineTable({})`. Add only your app's own fields. Usernames and verified emails live in the Convex Auth components, so don't copy them into your tables.
6. **Write `convex/auth.ts`.** Set up the core, then the method, then attach the user callbacks. The method's functions exist only after `.attachUserCallbacks(...)`.
   ```ts
   import { setupUsernamePasskey } from "@convex-dev/auth/methods/username-passkey/server";
   import { setupConvexAuth } from "@convex-dev/auth/server";
   import { components, internal } from "./_generated/api";
   import { env } from "./_generated/server";

   const auth = setupConvexAuth({ component: components.auth });
   export const { signOut, refreshSession, isAuthenticated } = auth;

   export const {
     startSignInWithUsernamePasskey,
     startAutofillSignInWithUsernamePasskey,
     finishSignUpWithUsernamePasskey,
     finishSignInWithUsernamePasskey,
   } = setupUsernamePasskey(auth, {
     component: components.authPasskey,
     usernameComponent: components.authUsername,
     rpId: env.PASSKEY_RP_ID ?? "localhost",
     origin: env.PASSKEY_ORIGIN?.split(",") ?? "http://localhost:5173", // http://localhost:3000 for next dev
   }).attachUserCallbacks({ createUser: internal.users.createUser });
   ```
   Read `rpId` and `origin` from `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` as shown, so each deployment gets its own values without code changes. Development needs no setup: the defaults cover the local dev server. They must match the domain the app is served from, and a passkey can't move to a different `rpId` later. `PASSKEY_RP_ID` is the domain without scheme or port (`example.com`); `PASSKEY_ORIGIN` is the full origin the sign-in page is served from (`https://example.com`), comma-separated when there are several. Before the app goes to production, set both on the production deployment with the Convex MCP `envSet` tool or `npx convex env set PASSKEY_RP_ID=example.com`. If the user mentions the domain the app will be served from, tell them the values to set. To let users manage passkeys, also export `listPasskeys`, `renamePasskey`, `startAddPasskey`, `verifyAddPasskey`, `finishAddPasskey`, `startRemovePasskey`, and `finishRemovePasskey` from the same call.
7. **Write `createUser`** in `convex/users.ts`. The `name` literal must match the method.
   ```ts
   import { v } from "convex/values";
   import { internalMutation } from "./_generated/server";

   export const createUser = internalMutation({
     args: {
       method: v.object({ name: v.literal("usernamePasskey"), profile: v.object({}) }),
     },
     returns: v.id("users"),
     handler: async (ctx) => {
       return await ctx.db.insert("users", {});
     },
   });
   ```
   One `createUser` serves every sign-in method. Make `method` a `v.union` with one `v.object({ name, profile })` per enabled method, and pass the same `internal.users.createUser` to every method's `.attachUserCallbacks(...)`. Branch on `method.name` when a method's profile needs handling. Take each method's `name` literal and `profile` validator from its docs page.
   ```ts
   args: {
     method: v.union(
       v.object({ name: v.literal("usernamePasskey"), profile: v.object({}) }),
       // one entry per additional method, using the name and profile validator from its docs page
     ),
   },
   ```
   When you add a method later, add its entry to the union instead of writing a second `createUser`.
   An optional `onSignIn` internal mutation, which receives `userId: v.id("users")`, runs on every sign-in. Attach it next to `createUser`.
8. **Use another method only when the user asks for it.** Convex Auth keeps adding methods, so check the docs (https://docs.convex.dev/auth/convex-auth/) for the current list instead of assuming what's available, and follow the chosen method's page exactly. Every method fits the same pattern as the passkey setup above:
   - mount the components it needs in `convex/convex.config.ts`
   - call its `setup<Method>(auth, {...}).attachUserCallbacks({ createUser: ... })` in `convex/auth.ts` and export the functions it returns
   - add its entry to the `createUser` union (step 7)
   - set any secrets it needs on the deployment, with the Convex MCP `envSet` tool or `npx convex env set NAME=VALUE`
   - build its UI with that method's React hooks
     If the user asks for a method the docs don't list, say so rather than improvising one.
9. **Wire the client.** Pick the path that matches the app.
   - React SPA (Vite and similar): wrap the app in `ConvexAuthProvider` from `@convex-dev/auth/react`.
     ```tsx
     <ConvexAuthProvider
       client={convex}
       api={{
         refreshSession: api.auth.refreshSession,
         signOut: api.auth.signOut,
         isAuthenticated: api.auth.isAuthenticated,
       }}
     >
       <App />
     </ConvexAuthProvider>
     ```
   - Next.js App Router: don't use `ConvexAuthProvider`. Follow https://docs.convex.dev/auth/convex-auth/ssr-nextjs/setup and https://docs.convex.dev/auth/convex-auth/ssr-nextjs/methods exactly. That means `setupConvexAuthServer` from `@convex-dev/auth/ssr` in `src/lib/serverAuth.ts`, with a `signIn` allowlist of the functions that create a session (for passkeys, `finishSignUpWithUsernamePasskey` and `finishSignInWithUsernamePasskey`; the SSR methods page lists them for other methods). It also means POST route handlers at exactly `app/auth/signin/route.ts`, `app/auth/refresh/route.ts`, and `app/auth/signout/route.ts`, plus `setupConvexAuthNextjs` from `@convex-dev/auth/ssr/nextjs` in `src/lib/convexAuth.tsx`. Add a `proxy.ts` (not `middleware.ts`) at the project root, or at `src/proxy.ts` if the app uses `src/`, and keep `/auth` routes out of its matcher. Wrap the root layout's children in `<Suspense>` and then `<ConvexAuthNextjsServerProvider>`. In Server Components, check sign-in with `isAuthenticatedNextjs()` and pass `convexAuthNextjsAccessToken()` to `preloadQuery`.
10. **Build the sign-in UI.** Use the method's hook. Passkey sign-in is identifier-first: one call either creates an account for a new username or asks an existing user for their passkey.
    ```tsx
    import { useSignInWithUsernamePasskey } from "@convex-dev/auth/methods/username-passkey/react";

    const { signIn, pending, autofill } = useSignInWithUsernamePasskey(api.auth);
    const result = await signIn({ username });
    if (result.status !== "complete") setError(result.userError.error);
    ```
    Give the username input `autoComplete="username webauthn"` and show `autofill.lastError` too. Mount this hook only once at a time. Handle `userError.error` with an exhaustive `switch` that ends in `default: result.userError satisfies never;`, so new error codes break the build. Gate the UI with `Authenticated`, `Unauthenticated`, and `AuthLoading` from `convex/react`, and sign out with `useAuthActions().signOut` from `@convex-dev/auth/react`. In Next.js, components that use these hooks need `"use client"`. If you import shadcn/ui primitives (button, input, label, and so on), add them first with `npx shadcn@latest add <name>`; a missing `@/components/ui/*` is a hard build error.
11. **Read the user on the server.** In queries and mutations, call `const userId = await getAuthUserId(ctx)`, imported from `@convex-dev/auth/server`. It returns `null` when signed out. Then load the user with `ctx.db.get("users", userId)`. For the username, call `ctx.runQuery(components.authUsername.public.getUsername, { userId })`.
12. **Verify.** Run `npx convex dev --once`, the typecheck, and the build. Then ask the user to try sign-in in their browser: sign up, reload and stay signed in, sign out, and sign back in. Passkeys need a real or virtual authenticator, which headless browsers usually lack, so don't report sign-in as tested unless you actually ran that flow.

## Rules

- This skill and the Convex Auth docs it links to are authoritative. Convex Auth's API has changed across versions; follow this skill and the docs over what you remember. Don't write older-API code (`convexAuth({ providers })`, `auth.addHttpRoutes`, `authTables`, `JWT_PRIVATE_KEY`/`JWKS`, the `npx @convex-dev/auth` wizard, `useAuthActions().signIn("<provider>")`, `middleware.ts`). Fetch the docs page when you need a detail this skill doesn't cover.
- If the app already has auth, including the older Convex Auth API, stop and ask before replacing it. To move an app between versions, follow the migration guides in the Convex Auth docs rather than improvising.
- Always write `convex/auth.config.ts` with `convexAuthProvider()`. If it's missing or wrong, the app is always signed out and shows no error.
- Mount every component a method needs in `convex/convex.config.ts`, and export the method's functions from the `.attachUserCallbacks(...)` result.
- Use one `createUser` for all sign-in methods: its `method` arg is a `v.union` with one entry per enabled method, and every method attaches the same callback.
- Use username + passkey by default. Add another method only when the user asks, and check the docs for which methods exist rather than assuming.
- Read passkey `rpId` and `origin` from the `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` environment variables, with localhost defaults for development. They must match the domain the app is served from, and a passkey can't move to a different `rpId` later, so set both on the production deployment before deploying.
- In Next.js, use `proxy.ts`, not `middleware.ts`, and keep `/auth` routes out of its matcher.
- Install any shadcn/ui primitive you import up front (`npx shadcn@latest add ...`); a missing `@/components/ui/*` is a hard build failure.
- Don't report sign-in as tested unless you ran the flow. Passkeys need a real or virtual authenticator, so leave the in-browser check to the user.

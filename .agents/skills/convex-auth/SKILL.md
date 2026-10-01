---
name: convex-auth
description: "Add authentication (passkeys/OAuth) to the current Convex app, including the auth.config.ts wiring."
---

<!-- GENERATED from convex-agents content/capabilities/auth.json — do not edit by hand. -->

# Add sign-in to the app

Install and wire @convex-dev/auth for the current app: a provider (passkeys by default, or OAuth/password), the server config, the client hooks, and a sign-in UI — correctly, including the auth.config.ts that's the #1 real-world auth footgun.

## Workflow

1. Install @convex-dev/auth (pinned build) and add it to convex.config.ts. With pnpm, also `pnpm add jose` (it won't hoist otherwise); you need it for step 3.
2. Add the provider in convex/auth.ts (Passkey by default; Password or OAuth like Google on request).
3. Generate the auth keys HEADLESSLY. Do NOT run the interactive `npx @convex-dev/auth` wizard: it needs a login/TTY and hangs in non-interactive, anonymous, or CI runs (the #1 auth time-sink). Generate JWT_PRIVATE_KEY + JWKS deterministically with `jose`:
   node -e 'import("jose").then(async({generateKeyPair,exportPKCS8,exportJWK})=>{const k=await generateKeyPair("RS256",{extractable:true});const priv=await exportPKCS8(k.privateKey);const pub=await exportJWK(k.publicKey);process.stdout.write(JSON.stringify({JWT_PRIVATE_KEY:priv.trimEnd().replace(/\n/g," "),JWKS:JSON.stringify({keys:[{use:"sig",...pub}]})}))})' > .auth-keys.json
   Then set JWT_PRIVATE_KEY and JWKS (from .auth-keys.json) plus SITE_URL on the deployment. Prefer the Convex MCP `envSet` tool, one call per var, to avoid shell-quoting the multi-line key. CLI fallback: use the NAME=VALUE form (`npx convex env set "JWT_PRIVATE_KEY=$JWT"`), NEVER `env set JWT_PRIVATE_KEY "$JWT"` (the value starts with `-----BEGIN` and the CLI parses the leading `-` as an unknown flag). SITE_URL is the dev URL (e.g. http://localhost:3000). Delete .auth-keys.json after.
4. Write convex/auth.config.ts (the silently-always-signed-out bug lives here if it's wrong).
5. Wire the client: ConvexAuthProvider, the sign-in component, and route guards. If you import shadcn/ui primitives (button, input, textarea, label, and so on), add them first with `npx shadcn@latest add <name>`; a missing @/components/ui/* is a hard build error.
6. Verify a sign-in round-trips before declaring done.

## Rules

- Generate JWT_PRIVATE_KEY/JWKS with `jose` (extractable RS256; PKCS8 newlines to spaces; JWKS = {keys:[{use:"sig", ...publicJwk}]}). Do NOT run the interactive `npx @convex-dev/auth` wizard: it hangs headless/anonymous. Set the vars via the MCP `envSet` tool or the NAME=VALUE CLI form.
- Always write auth.config.ts: a missing/incorrect one makes the app silently always-signed-out with no error.
- Passkeys by default; only switch to password/OAuth on explicit request.
- Install any shadcn/ui primitive you import up front (`npx shadcn@latest add ...`); a missing @/components/ui/* is a hard build failure.
- Verify a real sign-in works before finishing.

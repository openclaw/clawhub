# CLAUDE.md

## Project Overview

ClawHub is a full-stack TypeScript skill registry — a platform for publishing, discovering, and installing AI skills/plugins. It consists of a React web app, a Convex serverless backend, a CLI tool, and a shared schema package organized as a Bun monorepo.

## Tech Stack

- **Frontend:** React 19, TanStack Start/Router, Vite 7, TailwindCSS 4
- **Backend:** Convex (database, file storage, serverless functions, crons)
- **Auth:** GitHub OAuth via @convex-dev/auth
- **Search:** OpenAI embeddings (text-embedding-3-small) + Convex vector search
- **CLI:** Commander.js, published as `clawhub`/`clawdhub`
- **Schema validation:** ArkType
- **Package manager:** Bun (enforced — do not use npm/yarn/pnpm)
- **Deployment:** Vercel (frontend), Convex Cloud (backend)

## Repository Structure

```
src/                       # Web app (React + TanStack Start)
  ├── components/          # React components
  ├── routes/              # File-based routing (TanStack Router)
  └── lib/                 # Client-side utilities
convex/                    # Backend (Convex functions + schema)
  ├── lib/                 # Shared backend utilities
  ├── httpApiV1/           # REST API endpoints
  └── _generated/          # Auto-generated (do not edit)
packages/
  ├── clawdhub/            # CLI tool package
  │   └── src/cli/commands/  # CLI commands (inspect, install, etc.)
  └── schema/              # Shared types & schemas (clawhub-schema)
      └── src/             # SkillLicense, SkillFrontmatter, etc.
e2e/                       # End-to-end tests (Playwright)
docs/                      # Documentation
```

## Common Commands

```bash
bun install                  # Install dependencies (always use bun)
bun run dev                  # Start dev server on port 3000
bunx convex dev              # Start Convex backend locally
bun run build                # Production build (Vite + Nitro)
bun run test                 # Run unit tests (Vitest)
bun run lint                 # Run linter (oxlint, type-aware)
bun run lint:fix             # Auto-fix lint + format (oxlint + oxfmt)
npx tsc --noEmit             # TypeScript type check
bun run coverage             # Run tests with coverage report
bun run test:e2e             # End-to-end tests
```

## Development Workflow

### Before committing, always run:
1. `bun run lint` — oxlint with type-aware rules
2. `npx tsc --noEmit` — TypeScript compilation check
3. `bun run test` — Vitest unit tests

### Commit conventions:
Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`

### TypeScript rules:
- Strict mode is enabled; `noUnusedLocals` and `noUnusedParameters` are enforced
- `no-explicit-any` is an error in oxlint — use proper types
- Target: ES2022, module resolution: "bundler"

## Key Architectural Patterns

### Type sharing
The `packages/schema` package (`clawhub-schema`) is the canonical source for shared types like `SkillLicense`, `ClawdisSkillMetadata`, `SkillInstallSpec`. Always import types from `clawhub-schema` rather than defining inline types. The Convex backend re-exports some types from `convex/lib/skills.ts`.

### Convex backend
- `convex/schema.ts` defines the database schema
- Queries, mutations, and actions are in `convex/*.ts`
- Shared utilities live in `convex/lib/`
- HTTP API endpoints are in `convex/httpApiV1/`
- `convex/_generated/` is auto-generated — never edit these files

### Frontmatter parsing
Skills use YAML frontmatter in SKILL.md files. The backend's `parseLicenseField()` in `convex/lib/skills.ts` is the canonical parser. The frontend in `src/routes/upload.tsx` does display-only parsing; the backend is authoritative.

### Schema validation
ArkType schemas in `packages/schema/src/schemas.ts` define API contracts. Use `'string > 0'` for non-empty strings, `SkillLicenseSchema.or('null').optional()` for nullable optional license fields.

## Git & GitHub

### Repository setup:
- **Fork:** `jack-piplabs/clawhub` (origin)
- **Upstream:** `openclaw/clawhub`
- PRs are opened against `openclaw/clawhub`

### Automated reviewers on PRs:
- **Greptile** — AI code review (type safety, patterns)
- **Vercel** — Deployment preview + review
- **OpenAI Codex** — Code quality checks
- **CI** — GitHub Actions (lint, test, build)
- **Security Gate** — Secret scanning

### PR workflow:
1. Push to fork branch
2. PR is auto-reviewed by bots
3. Address legitimate findings (verify before fixing — bots can be wrong)
4. Re-trigger reviews by posting a PR comment: `@greptileai @codex review`
   - Note: Fine-grained PATs scoped to the fork cannot comment on the upstream repo — post the comment manually on GitHub if needed

## Testing

- **Framework:** Vitest with jsdom environment
- **Coverage thresholds:** 70% for lines, functions, branches, statements
- **Test files:** Co-located as `*.test.ts` / `*.test.tsx`
- **E2E:** Playwright (`e2e/` directory)
- **Setup:** `vitest.setup.ts` for global test config

## Environment Variables

See `.env.local.example` for required variables. Key ones:
- `CONVEX_DEPLOYMENT` — Convex project URL
- GitHub OAuth credentials for auth
- `OPENAI_API_KEY` — For embeddings (optional)
- `VT_API_KEY` — VirusTotal integration (optional)

## Common Pitfalls

- **Always use `bun`** — the preinstall hook blocks npm/yarn
- **Don't edit `convex/_generated/`** — these files are auto-generated by Convex
- **Import shared types from `clawhub-schema`** — don't create inline type annotations that duplicate existing types (e.g. `SkillLicense`)
- **ArkType syntax** — uses string-based type expressions (e.g. `'string?'`, `'boolean?'`, `'string > 0'`)
- **Convex validators** use `v.string()`, `v.optional()`, etc. — different from ArkType schemas

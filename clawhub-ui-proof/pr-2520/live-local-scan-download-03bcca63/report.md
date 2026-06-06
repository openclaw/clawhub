# PR 2520 live local proof

Status: pass

Captured from a live local ClawHub dev server started with `bun run dev` at `http://localhost:3000`.

Screenshots cover:

- dedicated account-banned page at desktop and mobile widths
- moderation email output generated from `convex/lib/emails.ts` and served through the same local ClawHub dev server
- account-ban email appeal-only copy
- skill rejection email with `clawhub scan download demo-skill --version 1.2.3`
- plugin rejection email with `clawhub scan download @scope/demo --version 2.0.0 --kind plugin`

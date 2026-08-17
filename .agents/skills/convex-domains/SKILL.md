---
name: convex-domains
description: "Point a domain you already own at your Convex app (DNS records, custom-domain attach, auth-origin rebind)."
---

<!-- GENERATED from convex-agents content/capabilities/domains.json — do not edit by hand. -->

# Set up a custom domain with your own provider

Walk the user's own registrar through pointing their domain at the Convex app: identify the target (hosting or deployment URL), create the DNS records, attach the custom domain, and rebind the auth origin if the app uses auth.

## Workflow

1. Identify the target: the published site host (for `*.convex.app` static hosting) or the deployment's HTTP actions URL.
2. Detect an ALREADY-AUTHENTICATED DNS CLI for the user's provider and OFFER to create the records automatically: Cloudflare → `flarectl dns create` (note: `wrangler` itself doesn't manage DNS records) or the CF API via their token env; Route53 → `aws route53 change-resource-record-sets`; Google Cloud DNS → `gcloud dns record-sets create`; DigitalOcean → `doctl compute domain records create`; Vercel DNS → `vercel dns add`. Check auth read-only first (`flarectl user info` / `aws sts get-caller-identity` / `doctl account get`); show the exact commands and get a yes before running.
3. If no authed CLI (or the user declines), tell the user exactly which records to create at THEIR registrar: the CNAME (or A/ALIAS at the apex) plus the TXT verification record — with concrete host/value strings, not placeholders.
4. Attach the domain as a Convex custom domain (dashboard or CLI) and wait for verification; note DNS propagation can take minutes to hours. Verify records landed with `dig +short`.
5. If the app uses auth (passkeys/OAuth), rebind the auth origin (SITE_URL / RP_ID / ORIGIN env vars) to the new domain and re-deploy/re-publish.
6. Verify: the domain serves the app over HTTPS, including the apex → www redirect if configured.

## Rules

- Never ask for or handle registrar credentials. A CLI already authenticated on the user's machine is fine — the credential stays in the tool; never install a CLI or run its login/auth flow for this, and never echo tokens.
- DNS changes on a live domain are user-visible: show the exact commands and confirm before running them; verify afterwards with dig.
- Always include the TXT verification record, not just the CNAME.
- Rebinding the domain changes the auth origin — re-publish after, or sign-in breaks.

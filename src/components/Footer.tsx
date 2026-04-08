import { getSiteName } from "../lib/site";
import { Separator } from "./ui/separator";

export function Footer() {
  const siteName = getSiteName();
  return (
    <footer className="mt-auto px-7 pb-8 pt-12">
      <div className="mx-auto max-w-[1200px]">
        <Separator className="mb-6" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.82rem] text-[color:var(--ink-soft)]">
          <span className="font-semibold text-[color:var(--ink)]">{siteName}</span>
          <FooterLink href="https://openclaw.ai">OpenClaw</FooterLink>
          <FooterLink href="https://vercel.com">Vercel</FooterLink>
          <FooterLink href="https://www.convex.dev">Convex</FooterLink>
          <FooterLink href="https://github.com/openclaw/clawhub">Open source (MIT)</FooterLink>
          <FooterLink href="https://steipete.me">Peter Steinberger</FooterLink>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[color:var(--ink-soft)] transition-colors duration-150 hover:text-[color:var(--ink)]"
    >
      {children}
    </a>
  );
}

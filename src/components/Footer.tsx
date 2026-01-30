import { getSiteName } from '../lib/site'
import { Separator } from './ui/separator'

export function Footer() {
  const siteName = getSiteName()
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <Separator />
        <div className="flex flex-col items-center gap-2 text-center">
          <span>
            {siteName} · A{' '}
            <a href="https://molt.bot" target="_blank" rel="noreferrer" className="underline">
              Moltbot
            </a>{' '}
            project ·{' '}
            <a
              href="https://github.com/moltbot/molthub"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open source (MIT)
            </a>{' '}
            ·{' '}
            <a href="https://steipete.me" target="_blank" rel="noreferrer" className="underline">
              Peter Steinberger
            </a>
            .
          </span>
        </div>
      </div>
    </footer>
  )
}

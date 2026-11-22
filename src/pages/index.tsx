/**
 * Landing page at `/` — a STATIC page (no auth call, no WebSocket), and
 * prerendered to HTML at build so search engines and link previews read it.
 *
 * One job: say what this is in a sentence and get the driver onto the map.
 * Keep `data-testid="static-landing"` — the scaffold's smoke tests use it.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { DISPLAY_NAME } from '../constants'
import { seo } from '../seo'

const LEGEND = [
  { label: 'Working', color: 'var(--color-ev-working)', text: 'Charged fine, ports open' },
  { label: 'Busy', color: 'var(--color-ev-busy)', text: 'Every port taken' },
  { label: 'Broken', color: 'var(--color-ev-broken)', text: 'Down, erroring, or blocked' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
          <p className="mb-6 text-sm font-medium tracking-wide text-primary">{DISPLAY_NAME} · Austin, TX</p>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            Know before you drive there.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            A live map of 500+ public EV chargers around Austin, updated by the drivers standing at them.
            Reports vanish after three hours, so what you see is what&apos;s true now.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/map"
              className="inline-flex items-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open the live map
            </Link>
            <span className="text-sm text-muted-foreground">No account needed to look.</span>
          </div>

          <ul className="mt-14 grid gap-4 border-t border-border pt-8 sm:grid-cols-3">
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-start gap-3">
                <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: l.color }} />
                <span>
                  <span className="block text-sm font-semibold">{l.label}</span>
                  <span className="block text-sm text-muted-foreground">{l.text}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-10 max-w-xl text-sm text-muted-foreground">
            Spot a report that&apos;s wrong? Dispute it. Enough disputes and it stops coloring the pin. Confirm the
            good ones so the next driver can trust them.
          </p>
        </div>
      </div>
    </>
  )
}

/**
 * /map — the live status map. This is the app.
 *
 * Lives under (app)/ so it gets the DeepSpace auth + realtime providers, but
 * NOT under (protected)/, so signed-out visitors can read the map. Posting
 * and voting prompt for sign-in.
 *
 * Data flow:
 *   useQuery('reports') + useQuery('votes')  — realtime subscriptions; any
 *        driver's new report or vote arrives over the WebSocket within ms
 *   → scoreReports()                          — drop expired, tally votes
 *   → statusOf(stationId)                     — colors each pin
 *
 * `now` ticks every 30 s so reports fade out on time even if nobody writes.
 */

import { useEffect, useMemo, useState } from 'react'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import { Search, Zap } from 'lucide-react'
import StationMap from '../../components/StationMap'
import StationPanel, { STATUS_LABEL } from '../../components/StationPanel'
import { cn } from '../../lib/utils'
import { STATION_BY_ID, STATIONS } from '../../lib/stations'
import { currentStatus, scoreReports, type StationStatus } from '../../lib/station-status'
import type { Report } from '../../schemas/reports-schema'
import type { Vote } from '../../schemas/votes-schema'

const FILTERS: StationStatus[] = ['working', 'busy', 'broken', 'unknown']
const DOT: Record<StationStatus, string> = {
  working: 'bg-[var(--color-ev-working)]',
  busy: 'bg-[var(--color-ev-busy)]',
  broken: 'bg-[var(--color-ev-broken)]',
  unknown: 'bg-[var(--color-ev-unknown)]',
}

export default function MapPage() {
  const { userId, isSignedIn } = useAuth()
  const { records: reports } = useQuery<Report>('reports', { orderBy: 'createdAt', orderDir: 'desc', limit: 1000 })
  const { records: votes } = useQuery<Vote>('votes')

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null)
  const [hidden, setHidden] = useState<Set<StationStatus>>(new Set())
  const [fastOnly, setFastOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  const byStation = useMemo(() => scoreReports(reports, votes, now), [reports, votes, now])
  const statusOf = useMemo(() => (id: string) => currentStatus(byStation.get(id)), [byStation])

  const myVotes = useMemo(() => {
    const m = new Map<string, (typeof votes)[number]>()
    for (const v of votes) if (v.data.userId === userId) m.set(v.data.reportId, v)
    return m
  }, [votes, userId])

  const counts = useMemo(() => {
    const c: Record<StationStatus, number> = { working: 0, busy: 0, broken: 0, unknown: 0 }
    for (const s of STATIONS) c[statusOf(s.id)]++
    return c
  }, [statusOf])

  const visible = useMemo(
    () => STATIONS.filter((s) => !hidden.has(statusOf(s.id)) && (!fastOnly || s.fast)),
    [hidden, fastOnly, statusOf],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return STATIONS.filter((s) => `${s.name} ${s.network}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query])

  const recent = useMemo(() => {
    const all = [...byStation.values()].flat().filter((r) => !r.disputed)
    return all.sort((a, b) => b.createdMs - a.createdMs).slice(0, 6)
  }, [byStation])

  const selected = selectedId ? STATION_BY_ID.get(selectedId) : undefined

  function select(id: string) {
    setSelectedId(id)
    const s = STATION_BY_ID.get(id)
    if (s) setFlyTo([s.lat, s.lng])
  }

  function toggle(s: StationStatus) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  return (
    <div className="relative flex h-full flex-col md:flex-row" data-testid="map-page">
      <div className="relative min-h-0 flex-1">
        <StationMap
          stations={visible}
          statusOf={statusOf}
          selectedId={selectedId}
          onSelect={select}
          flyTo={flyTo}
        />

        {/* Floating controls over the map */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col gap-2 p-3">
          {/* z-20: the results dropdown must paint above the filter chips below it. */}
          <div className="pointer-events-auto relative z-20 w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a station — “Whole Foods”, “Tesla”, “Domain”…"
              className="h-10 w-full rounded-lg border border-border bg-card/95 pl-9 pr-3 text-sm text-foreground shadow-lg backdrop-blur placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Search stations"
            />
            {matches.length > 0 && (
              <ul className="absolute mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                {matches.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        select(s.id)
                        setQuery('')
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className={cn('size-2 shrink-0 rounded-full', DOT[statusOf(s.id)])} />
                      <span className="truncate">{s.name}</span>
                      {s.fast && <Zap className="ml-auto size-3 shrink-0 text-primary" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            {FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => toggle(s)}
                aria-pressed={!hidden.has(s)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs shadow backdrop-blur transition',
                  hidden.has(s) ? 'text-muted-foreground opacity-50' : 'text-foreground',
                )}
              >
                <span className={cn('size-2 rounded-full', DOT[s])} />
                {s === 'unknown' ? 'No reports' : STATUS_LABEL[s]}
                <span className="tabular-nums text-muted-foreground">{counts[s]}</span>
              </button>
            ))}
            <button
              onClick={() => setFastOnly((v) => !v)}
              aria-pressed={fastOnly}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs shadow backdrop-blur transition',
                fastOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card/95 text-foreground',
              )}
            >
              <Zap className="size-3" /> DC fast only
            </button>
          </div>
        </div>
      </div>

      {/* Side panel (desktop) / bottom sheet (mobile) */}
      <aside
        className={cn(
          'z-[1000] border-border bg-card',
          'max-h-[55%] border-t md:max-h-none md:w-[380px] md:border-l md:border-t-0',
          !selected && 'hidden md:block',
        )}
      >
        {selected ? (
          <StationPanel
            key={selected.id}
            station={selected}
            reports={byStation.get(selected.id) ?? []}
            myVotes={myVotes}
            now={now}
            onClose={() => setSelectedId(null)}
            onSignIn={() => setShowAuth(true)}
          />
        ) : (
          <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Is that charger actually working?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tap any pin to see what drivers reported in the last 3 hours — or add your own. Confirm or
                dispute reports to keep them honest.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Latest reports
              </h3>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No live reports yet. Be the first driver to post one.</p>
              ) : (
                <ul className="space-y-1">
                  {recent.map((r) => {
                    const st = STATION_BY_ID.get(r.record.data.stationId)
                    if (!st) return null
                    return (
                      <li key={r.record.recordId}>
                        <button
                          onClick={() => select(st.id)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', DOT[r.record.data.status])} />
                          <span className="truncate">{st.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {STATUS_LABEL[r.record.data.status]}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <p className="mt-auto text-xs text-muted-foreground">
              {STATIONS.length} public chargers from OpenStreetMap. Station list may be incomplete.
            </p>
          </div>
        )}
      </aside>

      {showAuth && !isSignedIn && <AuthOverlay providers={['google', 'github']} onClose={() => setShowAuth(false)} />}
    </div>
  )
}

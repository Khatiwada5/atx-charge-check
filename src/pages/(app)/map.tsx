/**
 * /map — the live status map. This is the app.
 *
 * Lives under (app)/ so it gets the DeepSpace auth + realtime providers, but
 * NOT under (protected)/, so signed-out visitors can read the map. Posting
 * and voting prompt for sign-in.
 *
 * Data flow:
 *   useQuery('reports') + useQuery('votes')  — realtime subscriptions
 *   → scoreReports()                          — drop expired, tally votes
 *   → statusOf(stationId)                     — colors each pin
 *   + vehicle (My car) → compat()             — hides stations the car can't use
 *   + userLoc → distances, "Near you" list, route preview
 *
 * Layout:
 *   desktop — map on the left, 380px panel on the right
 *   phone   — full-screen map with a bottom sheet on top of it. The sheet has
 *             three heights: bar (collapsed), peek (station header + Start
 *             buttons), full. Tap or swipe the handle to change it.
 *
 * `now` ticks every 30 s so reports fade out on time even if nobody writes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import { Car, ChevronDown, LocateFixed, Loader2, Search, Zap } from 'lucide-react'
import StationMap from '../../components/StationMap'
import StationPanel, { STATUS_LABEL, type RouteState } from '../../components/StationPanel'
import VehiclePicker from '../../components/VehiclePicker'
import NavigationView, { type NavFrame } from '../../components/NavigationView'
import { useToast } from '../../components/ui'
import { cn } from '../../lib/utils'
import { STATION_BY_ID, STATIONS } from '../../lib/stations'
import { currentStatus, scoreReports, type StationStatus } from '../../lib/station-status'
import { compat, hasFastFor, VEHICLE_BY_ID, type Vehicle } from '../../lib/plugs'
import { distanceMeters, fetchRoute, formatMiles, getLocation, type LatLng, type Route } from '../../lib/geo'
import type { Report } from '../../schemas/reports-schema'
import { fetchTraffic, type Traffic } from '../../lib/traffic'
import type { Vote } from '../../schemas/votes-schema'

const FILTERS: StationStatus[] = ['working', 'busy', 'broken', 'unknown']
const DOT: Record<StationStatus, string> = {
  working: 'bg-[var(--color-ev-working)]',
  busy: 'bg-[var(--color-ev-busy)]',
  broken: 'bg-[var(--color-ev-broken)]',
  unknown: 'bg-[var(--color-ev-unknown)]',
}

type Sheet = 'bar' | 'peek' | 'full'
const SHEET_HEIGHT: Record<Sheet, string> = {
  bar: 'h-[72px]',
  peek: 'h-[46dvh]',
  full: 'h-[88dvh]',
}

const CAR_KEY = 'atx-charge-check:vehicle'
function loadVehicle(): Vehicle | null {
  try {
    return VEHICLE_BY_ID.get(localStorage.getItem(CAR_KEY) ?? '') ?? null
  } catch {
    return null
  }
}
function saveVehicle(v: Vehicle | null) {
  try {
    if (v) localStorage.setItem(CAR_KEY, v.id)
    else localStorage.removeItem(CAR_KEY)
  } catch {
    /* private mode — the choice just won't persist */
  }
}

export default function MapPage() {
  const { userId, isSignedIn } = useAuth()
  const toast = useToast()
  const { records: reports } = useQuery<Report>('reports', { orderBy: 'createdAt', orderDir: 'desc', limit: 1000 })
  const { records: votes } = useQuery<Vote>('votes')

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyTo, setFlyTo] = useState<LatLng | null>(null)
  const [hidden, setHidden] = useState<Set<StationStatus>>(new Set())
  const [fastOnly, setFastOnly] = useState(false)
  const [adapterOk, setAdapterOk] = useState(true)
  const [query, setQuery] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [vehicle, setVehicle] = useState<Vehicle | null>(loadVehicle)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [userLoc, setUserLoc] = useState<LatLng | null>(null)
  const [locating, setLocating] = useState(false)
  const [routeState, setRouteState] = useState<RouteState>({ kind: 'idle' })
  const [sheet, setSheet] = useState<Sheet>('bar')
  const routeAbort = useRef<AbortController | null>(null)
  // Turn-by-turn mode.
  const [navigating, setNavigating] = useState<{ stationId: string; route: Route; traffic: Traffic | null } | null>(null)
  const [navFrame, setNavFrame] = useState<NavFrame | null>(null)
  const [following, setFollowing] = useState(true)
  const [headingUp, setHeadingUp] = useState(true)
  const [starting, setStarting] = useState(false)

  // ── Status ───────────────────────────────────────────────────────────────
  const byStation = useMemo(() => scoreReports(reports, votes, now), [reports, votes, now])
  const statusOf = useCallback((id: string) => currentStatus(byStation.get(id)), [byStation])

  const myVotes = useMemo(() => {
    const m = new Map<string, (typeof votes)[number]>()
    for (const v of votes) if (v.data.userId === userId) m.set(v.data.reportId, v)
    return m
  }, [votes, userId])

  // ── Car compatibility ────────────────────────────────────────────────────
  const fitById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof compat>>()
    if (vehicle) for (const s of STATIONS) m.set(s.id, compat(s, vehicle.port))
    return m
  }, [vehicle])

  const usable = useMemo(
    () =>
      STATIONS.filter((s) => {
        if (!vehicle) return true
        const f = fitById.get(s.id)
        return f === 'direct' || (adapterOk && f === 'adapter')
      }),
    [vehicle, fitById, adapterOk],
  )
  const noPlugInfo = vehicle ? STATIONS.filter((s) => fitById.get(s.id) === 'unknown').length : 0
  const needsAdapter = useCallback((id: string) => fitById.get(id) === 'adapter', [fitById])

  const counts = useMemo(() => {
    const c: Record<StationStatus, number> = { working: 0, busy: 0, broken: 0, unknown: 0 }
    for (const s of usable) c[statusOf(s.id)]++
    return c
  }, [usable, statusOf])

  const visible = useMemo(
    () => usable.filter((s) => !hidden.has(statusOf(s.id)) && (!fastOnly || hasFastFor(s, vehicle?.port ?? null))),
    [usable, hidden, fastOnly, statusOf, vehicle],
  )

  // ── Search, nearby, latest ───────────────────────────────────────────────
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return STATIONS.filter((s) => `${s.name} ${s.network}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query])

  const nearby = useMemo(() => {
    if (!userLoc) return []
    return visible
      .map((s) => ({ s, d: distanceMeters(userLoc, [s.lat, s.lng]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
  }, [visible, userLoc])

  const recent = useMemo(() => {
    const all = [...byStation.values()].flat().filter((r) => !r.disputed)
    return all.sort((a, b) => b.createdMs - a.createdMs).slice(0, 6)
  }, [byStation])

  const selected = selectedId ? STATION_BY_ID.get(selectedId) : undefined

  // ── Actions ──────────────────────────────────────────────────────────────
  function select(id: string) {
    routeAbort.current?.abort()
    setRouteState({ kind: 'idle' })
    setSelectedId(id)
    setSheet('peek')
    const s = STATION_BY_ID.get(id)
    if (s) setFlyTo([s.lat, s.lng])
  }

  function closeStation() {
    routeAbort.current?.abort()
    setRouteState({ kind: 'idle' })
    setSelectedId(null)
    setSheet('bar')
  }

  async function locate(): Promise<LatLng | null> {
    setLocating(true)
    try {
      const loc = await getLocation()
      setUserLoc(loc)
      return loc
    } catch (e) {
      toast.error('Location unavailable', e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLocating(false)
    }
  }

  async function locateAndShowNearby() {
    const loc = await locate()
    if (!loc) return
    setFlyTo([...loc] as LatLng)
    if (!selectedId) setSheet('peek')
  }

  async function showRoute() {
    if (!selected) return
    routeAbort.current?.abort()
    const ctrl = new AbortController()
    routeAbort.current = ctrl
    setRouteState({ kind: 'loading' })
    const from = userLoc ?? (await locate())
    if (!from) return setRouteState({ kind: 'error', message: 'Turn on location to preview the route.' })
    try {
      const to: LatLng = [selected.lat, selected.lng]
      const [route, traffic] = await Promise.all([fetchRoute(from, to, ctrl.signal), fetchTraffic(from, to, ctrl.signal)])
      setRouteState({ kind: 'ready', route, traffic })
      setSheet('peek')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setRouteState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load a route.' })
    }
  }

  /**
   * Start in-app navigation: always route from a FRESH fix (the preview may
   * be from minutes ago), then hand over to NavigationView.
   */
  async function startNav() {
    if (!selected) return
    // iOS only allows speech that starts inside a tap — prime it now.
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.speak(new SpeechSynthesisUtterance(''))
    } catch {
      /* no voice support */
    }
    setStarting(true)
    try {
      const sim = new URLSearchParams(window.location.search).has('sim')
      const from = sim && userLoc ? userLoc : await locate()
      if (!from) return
      const to: LatLng = [selected.lat, selected.lng]
      const [r, traffic] = await Promise.all([fetchRoute(from, to), fetchTraffic(from, to)])
      setRouteState({ kind: 'ready', route: r, traffic })
      setFollowing(true)
      setNavigating({ stationId: selected.id, route: r, traffic })
    } catch (e) {
      toast.error('Could not start navigation', e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  function endNav(arrived: boolean) {
    setNavigating(null)
    setNavFrame(null)
    setRouteState({ kind: 'idle' })
    // Arrived → open the full sheet so reporting the charger is one tap away.
    setSheet(arrived ? 'full' : 'peek')
    if (navigating) {
      const s = STATION_BY_ID.get(navigating.stationId)
      if (s) setFlyTo([s.lat, s.lng])
    }
  }

  function pickVehicle(v: Vehicle | null) {
    setVehicle(v)
    saveVehicle(v)
    setPickerOpen(false)
  }

  function toggle(s: StationStatus) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  // Swipe on the sheet handle: up = bigger, down = smaller.
  const touchY = useRef<number | null>(null)
  const order: Sheet[] = ['bar', 'peek', 'full']
  function stepSheet(dir: 1 | -1) {
    setSheet((cur) => {
      const i = Math.min(2, Math.max(0, order.indexOf(cur) + dir))
      const next = order[i]
      if (next === 'bar' && selectedId) return 'peek'
      return next
    })
  }

  const route = routeState.kind === 'ready' ? routeState.route.coords : null
  const previewJams = routeState.kind === 'ready' ? (routeState.traffic?.jams ?? null) : null

  return (
    <div className="relative flex h-full flex-col md:flex-row" data-testid="map-page">
      <div className="relative min-h-0 flex-1">
        <StationMap
          stations={navigating && selected ? [selected] : visible}
          statusOf={statusOf}
          needsAdapter={needsAdapter}
          selectedId={selectedId}
          onSelect={select}
          flyTo={flyTo}
          userLoc={userLoc}
          route={route}
          jams={navigating ? (navFrame?.jams ?? null) : previewJams}
          nav={navigating ? navFrame : null}
          following={following}
          headingUp={headingUp}
          onUserPan={() => setFollowing(false)}
        />

        {!navigating && (<>
        {/* Floating controls over the map */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col gap-2 p-3">
          {/* z-20: the results dropdown must paint above the chips row below it. */}
          <div className="pointer-events-auto relative z-20 w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a station — Whole Foods, Domain…"
              className="h-12 w-full rounded-xl border border-border bg-card/95 pl-9 pr-3 text-base text-foreground shadow-lg backdrop-blur placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring md:h-10 md:text-sm"
              aria-label="Search stations"
            />
            {matches.length > 0 && (
              <ul className="absolute mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                {matches.map((s) => {
                  const f = fitById.get(s.id)
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          select(s.id)
                          setQuery('')
                        }}
                        className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent md:min-h-0"
                      >
                        <span className={cn('size-2 shrink-0 rounded-full', DOT[statusOf(s.id)])} />
                        <span className="truncate">{s.name}</span>
                        {vehicle && f === 'none' && <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">won&apos;t fit</span>}
                        {s.fast && <Zap className={cn('size-3 shrink-0 text-primary', !(vehicle && f === 'none') && 'ml-auto')} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Chips: one swipeable row on phones, wrapping on desktop */}
          <div className="pointer-events-auto -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setPickerOpen(true)}
              data-testid="my-car"
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow backdrop-blur',
                vehicle ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground',
              )}
            >
              <Car className="size-3.5" />
              <span className="max-w-[11rem] truncate">{vehicle ? vehicle.label : 'My car: any'}</span>
              <ChevronDown className="size-3" />
            </button>
            {vehicle && (
              <button
                onClick={() => setAdapterOk((v) => !v)}
                aria-pressed={adapterOk}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-xs shadow backdrop-blur',
                  adapterOk ? 'border-[var(--color-ev-busy)] bg-card/95 text-[var(--color-ev-busy)]' : 'border-border bg-card/95 text-muted-foreground',
                )}
              >
                {adapterOk ? 'Incl. adapter stations' : 'Direct fit only'}
              </button>
            )}
            {FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => toggle(s)}
                aria-pressed={!hidden.has(s)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 text-xs shadow backdrop-blur transition',
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
                'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs shadow backdrop-blur transition',
                fastOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/95 text-foreground',
              )}
            >
              <Zap className="size-3" /> DC fast only
            </button>
          </div>
        </div>

        {/* Locate me — above the zoom buttons */}
        <button
          onClick={locateAndShowNearby}
          aria-label="Show my location"
          className={cn(
            'absolute right-3 z-[1000] grid size-11 place-items-center rounded-xl border border-border bg-card/95 text-foreground shadow-lg backdrop-blur hover:bg-accent',
            'bottom-[92px] md:bottom-[96px]',
          )}
        >
          {locating ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed className={cn('size-5', userLoc && 'text-[#4f9dff]')} />}
        </button>
        </>)}
      </div>

      {/* Side panel (desktop) / bottom sheet (phone) */}
      <aside
        data-testid="sheet"
        data-sheet={sheet}
        className={cn(
          'absolute inset-x-0 bottom-0 z-[1001] flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.45)] transition-[height] duration-200',
          SHEET_HEIGHT[sheet],
          'md:static md:h-auto md:w-[380px] md:rounded-none md:border-l md:border-t-0 md:shadow-none md:transition-none',
          navigating && '!hidden',
        )}
      >
        {/* Handle (phones only) */}
        <button
          aria-label={sheet === 'full' ? 'Shrink panel' : 'Expand panel'}
          onClick={() => setSheet((s) => (s === 'full' ? (selectedId ? 'peek' : 'bar') : s === 'bar' ? 'peek' : 'full'))}
          onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
          onTouchEnd={(e) => {
            if (touchY.current == null) return
            const dy = e.changedTouches[0].clientY - touchY.current
            touchY.current = null
            if (Math.abs(dy) > 30) {
              e.preventDefault()
              stepSheet(dy < 0 ? 1 : -1)
            }
          }}
          className="flex w-full shrink-0 flex-col items-center pt-2 md:hidden"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
          {!selected && (
            <span className="mt-2 pb-2 text-sm font-medium text-foreground">
              {userLoc ? `${nearby.length ? 'Nearest chargers' : 'Nothing nearby'}` : 'Latest reports & nearby chargers'}
            </span>
          )}
        </button>

        <div className="min-h-0 flex-1">
          {selected ? (
            <StationPanel
              key={selected.id}
              station={selected}
              reports={byStation.get(selected.id) ?? []}
              myVotes={myVotes}
              now={now}
              vehicle={vehicle}
              userLoc={userLoc}
              routeState={routeState}
              onRoute={showRoute}
              starting={starting}
              onStart={startNav}
              onClose={closeStation}
              onSignIn={() => setShowAuth(true)}
            />
          ) : (
            <div className="flex h-full flex-col gap-5 overflow-y-auto p-5 pt-2 md:pt-5">
              <div className="hidden md:block">
                <h2 className="text-lg font-semibold text-foreground">Is that charger actually working?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tap any pin to see what drivers reported in the last 3 hours, get directions, or add your own report.
                </p>
              </div>

              {!vehicle && (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed border-border px-4 text-left text-sm hover:bg-accent"
                >
                  <Car className="size-5 text-primary" />
                  <span>
                    <span className="block font-medium">What do you drive?</span>
                    <span className="block text-xs text-muted-foreground">Only show chargers that fit your car.</span>
                  </span>
                </button>
              )}

              <div>
                <h3 className="mb-2 flex items-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {vehicle ? `Near you · fits ${vehicle.label}` : 'Near you'}
                </h3>
                {!userLoc ? (
                  <button
                    onClick={locateAndShowNearby}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-sm font-medium hover:bg-accent"
                  >
                    {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
                    Use my location
                  </button>
                ) : nearby.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matching chargers. Try clearing a filter.</p>
                ) : (
                  <ul className="space-y-0.5" data-testid="nearby-list">
                    {nearby.map(({ s, d }) => (
                      <li key={s.id}>
                        <button
                          onClick={() => select(s.id)}
                          className="flex min-h-12 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent md:min-h-10"
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', DOT[statusOf(s.id)])} />
                          <span className="truncate">{s.name}</span>
                          {fitById.get(s.id) === 'adapter' && (
                            <span className="shrink-0 text-[10px] uppercase text-[var(--color-ev-busy)]">adapter</span>
                          )}
                          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{formatMiles(d)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Latest reports</h3>
                {recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="no-reports">
                    Nobody has reported a charger in the last 3 hours, so every pin is gray. Tap a pin, then
                    choose <span className="text-[var(--color-ev-working)]">Working</span>,{' '}
                    <span className="text-[var(--color-ev-busy)]">Busy</span> or{' '}
                    <span className="text-[var(--color-ev-broken)]">Broken</span> to color it for everyone.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {recent.map((r) => {
                      const st = STATION_BY_ID.get(r.record.data.stationId)
                      if (!st) return null
                      return (
                        <li key={r.record.recordId}>
                          <button
                            onClick={() => select(st.id)}
                            className="flex min-h-12 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent md:min-h-10"
                          >
                            <span className={cn('size-2 shrink-0 rounded-full', DOT[r.record.data.status])} />
                            <span className="truncate">{st.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[r.record.data.status]}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <p className="mt-auto pb-[env(safe-area-inset-bottom)] text-xs text-muted-foreground">
                {STATIONS.length} public chargers from OpenStreetMap
                {noPlugInfo > 0 && ` · ${noPlugInfo} have no plug info and are hidden while a car is selected`}. Some
                fast-charging networks are missing from OpenStreetMap.
              </p>
            </div>
          )}
        </div>
      </aside>

      {navigating && selected && (
        <NavigationView
          key={navigating.route.distanceM + navigating.stationId}
          station={selected}
          initialRoute={navigating.route}
          initialTraffic={navigating.traffic}
          following={following}
          headingUp={headingUp}
          onToggleHeading={() => setHeadingUp((h) => !h)}
          onRecenter={() => setFollowing(true)}
          onFrame={setNavFrame}
          onEnd={endNav}
        />
      )}

      <VehiclePicker open={pickerOpen} selectedId={vehicle?.id ?? null} onPick={pickVehicle} onClose={() => setPickerOpen(false)} />
      {showAuth && !isSignedIn && <AuthOverlay providers={['google', 'github']} onClose={() => setShowAuth(false)} />}
    </div>
  )
}

/**
 * NavigationView — in-app turn-by-turn driving mode ("Start").
 *
 * What it does, like Google / Apple Maps:
 *   - follows your GPS (watchPosition) and tells the map to zoom in and keep
 *     you in view, a little below center so you see the road ahead
 *   - big banner: next maneuver arrow, distance to it, the street
 *   - bottom bar: arrival time, minutes and miles left, mute, End
 *   - spoken directions (speechSynthesis) at ~½ mile, ~500 ft and at the turn,
 *     with lane advice; voice modes like the maps apps: All / Alerts only / Off
 *   - lane guidance: the lanes at the next turn, the ones to use lit up
 *   - compass button: heading-up (map turns with you) or north-up
 *   - live traffic (TomTom, via our worker): traffic-aware time left and
 *     arrival, delay shown in the bottom bar, slowdowns drawn on the route;
 *     refreshed every 2 minutes and after each reroute
 *   - reroutes automatically when you leave the route
 *   - keeps the screen awake (Wake Lock API, where the browser supports it)
 *   - on arrival, offers to report the charger's status
 *
 * The map itself stays in StationMap; this component only computes the
 * "frame" (where you are, which way you face, what's left of the route) and
 * hands it up through `onFrame`.
 *
 * `?sim=1` in the URL drives a simulated car along the route — handy for
 * trying navigation from a desk (`?sim=10` = 10× speed).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BellRing,
  Compass,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LocateFixed,
  RefreshCw,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { fetchRoute, formatMiles, type LatLng, type Route } from '../lib/geo'
import { bearing, indexRoute, instruction, laneAdvice, navDistance, progress, spokenWithLanes, type Progress } from '../lib/nav'
import type { Lane } from '../lib/geo'
import type { Station } from '../lib/stations'
import { delayTone, fetchTraffic, type Jam, type Traffic } from '../lib/traffic'

export type NavFrame = { pos: LatLng; heading: number | null; path: LatLng[]; jams: Jam[] | null }

const TRAFFIC_REFRESH_MS = 120_000
const TONE_TEXT = { ok: 'text-[var(--color-ev-working)]', slow: 'text-[var(--color-ev-busy)]', heavy: 'text-[var(--color-ev-broken)]' }

type Props = {
  station: Station
  initialRoute: Route
  initialTraffic: Traffic | null
  following: boolean
  headingUp: boolean
  onToggleHeading: () => void
  onRecenter: () => void
  onFrame: (f: NavFrame | null) => void
  onEnd: (arrived: boolean) => void
}

/** Voice modes, as in Google / Apple Maps. "alerts" = only the turn-now cues. */
type Voice = 'all' | 'alerts' | 'off'
const VOICE_KEY = 'atx-charge-check:nav-voice'
const VOICE_LABEL: Record<Voice, string> = { all: 'Voice on', alerts: 'Alerts only', off: 'Voice off' }
const NEXT_VOICE: Record<Voice, Voice> = { all: 'alerts', alerts: 'off', off: 'all' }

export default function NavigationView({ station, initialRoute, initialTraffic, following, headingUp, onToggleHeading, onRecenter, onFrame, onEnd }: Props) {
  const dest: LatLng = useMemo(() => [station.lat, station.lng], [station])
  const [route, setRoute] = useState(initialRoute)
  const idx = useMemo(() => indexRoute(route), [route])
  const [prog, setProg] = useState<Progress | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [voice, setVoice] = useState<Voice>(() => {
    try {
      const v = localStorage.getItem(VOICE_KEY)
      return v === 'alerts' || v === 'off' ? v : 'all'
    } catch {
      return 'all'
    }
  })
  const [voiceToast, setVoiceToast] = useState<string | null>(null)
  // Traffic, plus OSRM's typical-speed estimate for the same stretch when it
  // was fetched: their ratio scales the live "time left" between refreshes.
  const [traffic, setTraffic] = useState<{ t: Traffic; osrmS: number } | null>(
    initialTraffic ? { t: initialTraffic, osrmS: initialRoute.durationS } : null,
  )
  const trafficRef = useRef(traffic)
  trafficRef.current = traffic

  // Mutable navigation state that shouldn't trigger renders.
  // Heading starts as the route's first direction so the intro camera already faces the road.
  const st = useRef({
    hint: 0,
    offCount: 0,
    lastReroute: 0,
    last: null as LatLng | null,
    heading: (initialRoute.steps[0]?.maneuver.bearingAfter ?? null) as number | null,
    spoken: new Set<string>(),
    started: false,
  })
  const lastProg = useRef<Progress | null>(null)
  const idxRef = useRef(idx)
  idxRef.current = idx
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  /** `alert` cues (turn now, reroute, arrival) still play in "Alerts only". */
  function say(text: string, key: string, alert = false) {
    if (st.current.spoken.has(key)) return
    st.current.spoken.add(key)
    const v = voiceRef.current
    if (v === 'off' || (v === 'alerts' && !alert) || typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    speechSynthesis.speak(u)
  }

  // ── Handle one GPS fix ─────────────────────────────────────────────────
  const handleFix = useRef<(pos: LatLng, gpsHeading: number | null, acc: number) => void>(() => {})
  handleFix.current = (pos, gpsHeading, acc) => {
    const s = st.current
    const ix = idxRef.current
    const p = progress(ix, pos, s.hint, acc)
    s.hint = p.snap.seg

    // Heading: GPS course when moving, else derived from the last two fixes.
    if (gpsHeading != null && !Number.isNaN(gpsHeading)) s.heading = gpsHeading
    else if (s.last && distanceApprox(s.last, pos) > 4) s.heading = bearing(s.last, pos)
    s.last = pos

    setProg(p)
    const shown = p.snap.offM < 30 ? p.snap.point : pos
    onFrameRef.current({
      pos: shown,
      heading: s.heading,
      path: [p.snap.point, ...ix.route.coords.slice(p.snap.seg + 1)],
      jams: trafficRef.current?.t.jams ?? null,
    })
    lastProg.current = p

    // Voice prompts for the next maneuver.
    if (p.arrived) {
      say(`${instruction(ix.route.steps[ix.route.steps.length - 1])}. ${station.name}.`, `arrive`, true)
    } else if (p.next >= 0) {
      const step = ix.route.steps[p.next]
      const key = `${ix.route.distanceM}:${p.next}`
      if (!s.started) {
        s.started = true
        const first = instruction(ix.route.steps[0])
        say(`Starting route to ${station.name}. ${first}.`, 'start')
        s.spoken.add(`${key}:first`)
      } else if (!s.spoken.has(`${key}:first`)) say(p.toNextM > 150 ? spokenWithLanes(step, p.toNextM) : instruction(step), `${key}:first`)
      else if (p.toNextM < 900 && p.toNextM > 600) say(spokenWithLanes(step, p.toNextM), `${key}:half`)
      else if (p.toNextM < 220 && p.toNextM > 90) say(spokenWithLanes(step, p.toNextM), `${key}:near`)
      else if (p.toNextM <= 45) say(instruction(step), `${key}:now`, true)
    }

    // Reroute after two consecutive off-route fixes, at most every 12 s.
    s.offCount = p.offRoute ? s.offCount + 1 : 0
    if (s.offCount >= 2 && Date.now() - s.lastReroute > 12_000) {
      s.lastReroute = Date.now()
      s.offCount = 0
      setRerouting(true)
      Promise.all([fetchRoute(pos, dest), fetchTraffic(pos, dest)])
        .then(([r, t]) => {
          s.hint = 0
          setRoute(r)
          setTraffic(t ? { t, osrmS: r.durationS } : null)
          say('Rerouting', `reroute-${s.lastReroute}`, true)
        })
        .catch(() => {})
        .finally(() => setRerouting(false))
    }
  }

  // ── GPS (real or simulated) ────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('sim')) {
      // Drive along the initial route at ~45 km/h, one fix per (simulated)
      // second. `?sim=10` plays it 10× faster.
      const speed = Math.min(50, Math.max(1, Number(params.get('sim')) || 1))
      const pts = densify(initialRoute.coords, 12.5)
      let i = 0
      const t = setInterval(() => {
        if (i >= pts.length) return clearInterval(t)
        handleFix.current(pts[i], null, 5)
        i++
      }, 1000 / speed)
      return () => clearInterval(t)
    }
    if (!('geolocation' in navigator)) {
      setGpsError('Location is not available in this browser.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsError(null)
        handleFix.current([p.coords.latitude, p.coords.longitude], p.coords.heading, p.coords.accuracy)
      },
      (e) => setGpsError(e.code === e.PERMISSION_DENIED ? 'Location permission is off.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [initialRoute])

  // ── Refresh traffic every 2 minutes from where you are now ─────────────
  useEffect(() => {
    const t = setInterval(async () => {
      const pos = st.current.last
      const p = lastProg.current
      if (!pos || !p || p.arrived) return
      const fresh = await fetchTraffic(pos, dest)
      if (fresh) setTraffic({ t: fresh, osrmS: p.remainingS })
    }, TRAFFIC_REFRESH_MS)
    return () => clearInterval(t)
  }, [dest])

  // ── Keep the screen on ─────────────────────────────────────────────────
  useEffect(() => {
    type WakeLock = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }
    let lock: WakeLock | null = null
    const acquire = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    acquire()
    const onVis = () => document.visibilityState === 'visible' && acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => () => {
    onFrameRef.current(null)
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }, [])

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cycleVoice() {
    const nextV = NEXT_VOICE[voice]
    setVoice(nextV)
    try {
      localStorage.setItem(VOICE_KEY, nextV)
    } catch {
      /* ignore */
    }
    if (nextV !== 'all' && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    setVoiceToast(VOICE_LABEL[nextV])
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setVoiceToast(null), 1800)
  }

  const next = prog && prog.next >= 0 ? route.steps[prog.next] : null
  const after = prog && prog.next >= 0 && prog.next + 1 < route.steps.length ? route.steps[prog.next + 1] : null
  const showThen = !!(after && next && next.distanceM < 250)
  // Time left = OSRM's remaining estimate × (traffic time ÷ OSRM time when traffic was fetched).
  const factor = traffic && traffic.osrmS > 0 ? Math.min(3, Math.max(0.7, traffic.t.travelTimeS / traffic.osrmS)) : 1
  const remainingS = prog ? prog.remainingS * factor : 0
  const tone = traffic ? delayTone(traffic.t.delayS) : 'ok'
  const arrival = prog ? new Date(Date.now() + remainingS * 1000) : null

  return (
    <>
      {/* Top banner — the next maneuver */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[1200] p-2 pt-[max(0.5rem,env(safe-area-inset-top))]" data-testid="nav-banner">
        <div className="pointer-events-auto mx-auto max-w-xl overflow-hidden rounded-2xl bg-[#0f5d3a] text-white shadow-2xl">
          {prog?.arrived ? (
            <div className="flex items-center gap-3 p-4">
              <Flag className="size-9 shrink-0" />
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-tight">You&apos;ve arrived</p>
                <p className="truncate text-sm text-white/80">{station.name}</p>
              </div>
            </div>
          ) : next ? (
            <div className="flex items-center gap-3 p-4">
              <ManeuverIcon type={next.maneuver.type} modifier={next.maneuver.modifier} className="size-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-3xl font-bold leading-none tabular-nums" data-testid="nav-distance">
                  {navDistance(prog!.toNextM)}
                </p>
                <p className="mt-1 text-base font-medium leading-snug" data-testid="nav-instruction">
                  {instruction(next)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4">
              <LocateFixed className="size-8 shrink-0 animate-pulse" />
              <p className="text-lg font-semibold">{gpsError ?? 'Getting your location…'}</p>
            </div>
          )}
          {next && !prog?.arrived && next.lanes && laneAdvice(next) && prog!.toNextM < 1500 && (
            <LaneStrip lanes={next.lanes} />
          )}
          {showThen && after && (
            <div className="flex items-center gap-2 bg-black/25 px-4 py-2 text-sm">
              <span className="text-white/70">Then</span>
              <ManeuverIcon type={after.maneuver.type} modifier={after.maneuver.modifier} className="size-4" />
              <span className="truncate">{instruction(after)}</span>
            </div>
          )}
          {rerouting && (
            <div className="flex items-center gap-2 bg-black/25 px-4 py-2 text-sm">
              <RefreshCw className="size-4 animate-spin" /> Rerouting…
            </div>
          )}
        </div>
      </div>

      {/* Compass: heading-up ⇄ north-up (right edge, under the banner) */}
      <button
        onClick={onToggleHeading}
        aria-label={headingUp ? 'Switch to north up' : 'Switch to heading up'}
        data-testid="nav-compass"
        className="fixed right-3 top-[calc(9.5rem+env(safe-area-inset-top))] z-[1200] grid size-12 place-items-center rounded-full border border-border bg-card/95 text-foreground shadow-xl backdrop-blur"
      >
        <Compass className={cn('size-6', headingUp ? 'text-[#4f9dff]' : 'text-foreground')} />
        <span className="absolute -bottom-5 text-[10px] font-semibold text-white [text-shadow:0_1px_2px_#000]">{headingUp ? 'Heading' : 'North'}</span>
      </button>

      {voiceToast && (
        <div className="fixed left-1/2 top-1/2 z-[1250] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-black/80 px-5 py-3 text-base font-semibold text-white" data-testid="voice-toast">
          {voiceToast}
        </div>
      )}

      {/* Re-center after the user pans away */}
      {!following && (
        <button
          onClick={onRecenter}
          className="fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom))] left-1/2 z-[1200] flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 text-sm font-semibold text-foreground shadow-xl"
        >
          <LocateFixed className="size-4 text-[#4f9dff]" /> Re-center
        </button>
      )}

      {/* Bottom bar — ETA + controls */}
      <div className="fixed inset-x-0 bottom-0 z-[1200] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="nav-bottom">
        <div className="mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-2xl">
          <button
            onClick={cycleVoice}
            aria-label={`Voice: ${VOICE_LABEL[voice]}. Tap to change.`}
            data-testid="nav-voice"
            data-voice={voice}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-foreground"
          >
            {voice === 'all' ? <Volume2 className="size-5" /> : voice === 'alerts' ? <BellRing className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <div className="min-w-0 flex-1 text-center">
            {prog && !prog.arrived ? (
              <>
                <p className={cn('text-xl font-bold leading-tight tabular-nums', TONE_TEXT[tone])} data-testid="nav-eta" data-tone={tone}>
                  {Math.max(1, Math.round(remainingS / 60))} min
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatMiles(prog.remainingM)} · arrive {arrival!.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
                <p className={cn('text-[11px] leading-tight', traffic ? TONE_TEXT[tone] : 'text-muted-foreground')} data-testid="nav-traffic">
                  {traffic
                    ? traffic.t.delayS >= 60
                      ? `+${Math.round(traffic.t.delayS / 60)} min traffic`
                      : 'Light traffic'
                    : 'Typical traffic'}
                </p>
              </>
            ) : prog?.arrived ? (
              <p className="text-sm font-medium text-foreground">How is the charger?</p>
            ) : (
              <p className="text-sm text-muted-foreground">{formatMiles(route.distanceM)} · {Math.round(route.durationS / 60)} min</p>
            )}
          </div>
          <button
            onClick={() => onEnd(!!prog?.arrived)}
            data-testid="nav-end"
            className={cn(
              'flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold',
              prog?.arrived ? 'bg-primary text-primary-foreground' : 'bg-destructive text-destructive-foreground',
            )}
          >
            {prog?.arrived ? 'Report' : (<><X className="size-4" /> End</>)}
          </button>
        </div>
      </div>
    </>
  )
}

/** The lanes at the next turn, left → right; the ones to use are lit. */
function LaneStrip({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="flex items-center justify-center gap-1 bg-black/30 px-3 py-2" data-testid="nav-lanes" aria-label="Lane guidance">
      {lanes.map((l, i) => (
        <div
          key={i}
          data-valid={l.valid}
          className={cn('grid h-9 w-8 place-items-center rounded-md border', l.valid ? 'border-white/80 bg-white text-[#0f5d3a]' : 'border-white/20 text-white/35')}
        >
          <LaneArrow indication={pickIndication(l)} />
        </div>
      ))}
    </div>
  )
}

function pickIndication(l: Lane): string {
  const ind = l.indications.filter((x) => x !== 'none')
  return ind[0] ?? 'straight'
}

const LANE_ANGLE: Record<string, number> = {
  straight: 0,
  'slight right': 40,
  right: 90,
  'sharp right': 135,
  'slight left': -40,
  left: -90,
  'sharp left': -135,
}

function LaneArrow({ indication }: { indication: string }) {
  if (indication === 'uturn') return <Undo2 className="size-5" />
  const a = LANE_ANGLE[indication] ?? 0
  // Stem up from the bottom, head bent toward the lane's direction.
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 21 V12" />
      <g transform={`rotate(${a} 10 12)`}>
        <path d="M10 12 V3" />
        <path d="M5.5 7.5 L10 3 L14.5 7.5" />
      </g>
    </svg>
  )
}

function ManeuverIcon({ type, modifier, className }: { type: string; modifier?: string; className?: string }) {
  if (type === 'arrive') return <Flag className={className} />
  if (type === 'roundabout' || type === 'rotary') return <RefreshCw className={className} />
  const m = modifier ?? 'straight'
  if (m === 'uturn') return <Undo2 className={className} />
  if (m === 'sharp left') return <CornerUpLeft className={className} />
  if (m === 'sharp right') return <CornerUpRight className={className} />
  if (m === 'left') return <ArrowLeft className={className} />
  if (m === 'right') return <ArrowRight className={className} />
  if (m === 'slight left') return <ArrowUpLeft className={className} />
  if (m === 'slight right') return <ArrowUpRight className={className} />
  return <ArrowUp className={className} />
}

function distanceApprox(a: LatLng, b: LatLng) {
  const dy = (b[0] - a[0]) * 111_320
  const dx = (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/** Points every `stepM` meters along a line (for the simulator). */
function densify(coords: LatLng[], stepM: number): LatLng[] {
  const out: LatLng[] = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const n = Math.max(1, Math.floor(distanceApprox(a, b) / stepM))
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

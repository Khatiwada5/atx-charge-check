/**
 * StationPanel — details for the selected station.
 *
 *   1. Header: name, network, status, distance from you.
 *   2. Get there: "Start" begins in-app turn-by-turn navigation
 *      (NavigationView); "Preview" draws the route + ETA without starting;
 *      "Google Maps" / "Apple Maps" hand off to the phone's own nav app.
 *      This block sits at the top so it shows in the collapsed phone sheet.
 *   3. Plugs: every connector here, and — if a car is chosen — whether it
 *      plugs in directly, needs an adapter (and which), or won't fit.
 *   4. Report now: Working / Busy / Broken + optional note. Posting replaces
 *      your own previous live report for this station.
 *   5. Live reports with Confirm / Dispute and an expiry countdown.
 *
 * Writes are disabled until `useMutations().ready` (realtime socket up).
 */

import { useState, type ReactNode } from 'react'
import { useAuth, useMutations, useUserLookup, type RecordData } from 'deepspace'
import { Loader2, Navigation, Route as RouteIcon, ThumbsDown, ThumbsUp, X, Zap } from 'lucide-react'
import { Button, Textarea, useToast } from './ui'
import { cn } from '../lib/utils'
import type { Station } from '../lib/stations'
import { currentStatus, timeAgo, timeLeft, type ScoredReport, type StationStatus } from '../lib/station-status'
import { appleMapsUrl, distanceMeters, formatDuration, formatMiles, googleMapsUrl, type LatLng, type Route } from '../lib/geo'
import { compat, PLUG_LABEL, plugFit, stationPlugs, type Vehicle } from '../lib/plugs'
import { REPORT_TTL_HOURS, type Report, type ReportStatus } from '../schemas/reports-schema'
import type { Vote, VoteKind } from '../schemas/votes-schema'

export const STATUS_LABEL: Record<StationStatus, string> = {
  working: 'Working',
  busy: 'Busy',
  broken: 'Broken',
  unknown: 'No recent reports',
}

const STATUS_HINT: Record<ReportStatus, string> = {
  working: 'Charged fine / ports open',
  busy: 'All ports taken',
  broken: 'Down, error, or blocked',
}

export const STATUS_TEXT_CLASS: Record<StationStatus, string> = {
  working: 'text-[var(--color-ev-working)]',
  busy: 'text-[var(--color-ev-busy)]',
  broken: 'text-[var(--color-ev-broken)]',
  unknown: 'text-muted-foreground',
}

const STATUS_BG_CLASS: Record<ReportStatus, string> = {
  working: 'bg-[var(--color-ev-working)]',
  busy: 'bg-[var(--color-ev-busy)]',
  broken: 'bg-[var(--color-ev-broken)]',
}

export type RouteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; route: Route }
  | { kind: 'error'; message: string }

type Props = {
  station: Station
  reports: ScoredReport[]
  myVotes: Map<string, RecordData<Vote>>
  now: number
  vehicle: Vehicle | null
  userLoc: LatLng | null
  routeState: RouteState
  starting: boolean
  onRoute: () => void
  onStart: () => void
  onClose: () => void
  onSignIn: () => void
}

export default function StationPanel(props: Props) {
  const { station, reports, myVotes, now, vehicle, userLoc, routeState, starting, onRoute, onStart, onClose, onSignIn } = props
  const { isSignedIn, userId } = useAuth()
  const reportMut = useMutations<Report>('reports')
  const voteMut = useMutations<Vote>('votes')
  const { getName } = useUserLookup()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)

  const status = currentStatus(reports)
  const ready = reportMut.ready && voteMut.ready
  const dest: LatLng = [station.lat, station.lng]
  const plugs = stationPlugs(station)
  const fit = vehicle ? compat(station, vehicle.port) : null

  async function submit(next: ReportStatus) {
    if (!isSignedIn) return onSignIn()
    setPosting(true)
    try {
      for (const r of reports) {
        if (r.record.createdBy === userId) await reportMut.removeConfirmed(r.record.recordId)
      }
      await reportMut.createConfirmed({ stationId: station.id, status: next, note: note.trim().slice(0, 200) })
      setNote('')
      toast.success(`Reported ${STATUS_LABEL[next].toLowerCase()}`, `Visible for ${REPORT_TTL_HOURS} hours.`)
    } catch (e) {
      toast.error('Could not post report', e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  function vote(report: ScoredReport, kind: VoteKind) {
    if (!isSignedIn || !userId) return onSignIn()
    const mine = myVotes.get(report.record.recordId)
    if (!mine) voteMut.create({ reportId: report.record.recordId, userId, vote: kind })
    else if (mine.data.vote === kind) voteMut.remove(mine.recordId)
    else voteMut.put(mine.recordId, { vote: kind })
  }

  return (
    <div className="flex h-full flex-col" data-testid="station-panel">
      {/* 1. Header */}
      <div className="flex items-start gap-2 px-4 pb-3 pt-1 md:pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug text-foreground">{station.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {station.network && <span>{station.network}</span>}
            {station.fast && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Zap className="size-3" /> DC fast
              </span>
            )}
            {userLoc && <span>{formatMiles(distanceMeters(userLoc, dest))} away</span>}
          </p>
          <p className={cn('mt-1.5 text-sm font-medium', STATUS_TEXT_CLASS[status])} data-testid="station-status">
            {STATUS_LABEL[status]}
            {reports[0] && status !== 'unknown' && (
              <span className="font-normal text-muted-foreground"> · updated {timeAgo(reports[0].createdMs, now)}</span>
            )}
          </p>
          {fit && vehicle && <FitBadge fit={fit} vehicle={vehicle} />}
        </div>
        <button
          onClick={onClose}
          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* 2. Get there */}
      <div className="border-b border-border px-4 pb-4" data-testid="directions">
        <button
          onClick={onStart}
          disabled={starting}
          data-testid="nav-start"
          className="mb-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#1a7f4b] text-base font-bold text-white shadow-lg hover:bg-[#1d8f54] active:scale-[0.99] disabled:opacity-70"
        >
          {starting ? <Loader2 className="size-5 animate-spin" /> : <Navigation className="size-5 fill-current" />}
          {starting ? 'Starting…' : 'Start'}
          {routeState.kind === 'ready' && !starting && (
            <span className="font-medium text-white/80">· {formatDuration(routeState.route.durationS)}</span>
          )}
        </button>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onRoute}
            disabled={routeState.kind === 'loading'}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-2 text-xs font-medium text-foreground hover:border-foreground/30 disabled:opacity-60"
          >
            {routeState.kind === 'loading' && !starting ? <Loader2 className="size-4 animate-spin" /> : <RouteIcon className="size-4" />}
            Preview
          </button>
          <NavLink href={googleMapsUrl(dest)} label="Google Maps" testId="nav-google" />
          <NavLink href={appleMapsUrl(dest, station.name)} label="Apple Maps" testId="nav-apple" />
        </div>
        {routeState.kind === 'ready' && (
          <p className="mt-2 text-sm text-foreground" data-testid="route-summary">
            <span className="font-semibold">{formatDuration(routeState.route.durationS)}</span>
            <span className="text-muted-foreground"> · {formatMiles(routeState.route.distanceM)} by car</span>
          </p>
        )}
        {routeState.kind === 'error' && <p className="mt-2 text-xs text-destructive">{routeState.message}</p>}
      </div>

      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {/* 3. Plugs */}
        <section className="border-b border-border p-4" data-testid="plugs">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Plugs here</h3>
          {plugs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plug info for this station in OpenStreetMap.</p>
          ) : (
            <ul className="space-y-1.5">
              {plugs.map((p) => {
                const f = vehicle ? plugFit(p, vehicle.port) : null
                return (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{station.plugs[p]}×</span>
                    <span className="flex-1">
                      {PLUG_LABEL[p]}
                      {f?.fit === 'adapter' && <span className="block text-xs text-[var(--color-ev-busy)]">Needs {f.note}</span>}
                    </span>
                    {f && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          f.fit === 'direct' && 'bg-[var(--color-ev-working)]/15 text-[var(--color-ev-working)]',
                          f.fit === 'adapter' && 'bg-[var(--color-ev-busy)]/15 text-[var(--color-ev-busy)]',
                          f.fit === 'none' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {f.fit === 'direct' ? 'Fits' : f.fit === 'adapter' ? 'Adapter' : 'No fit'}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 4. Report */}
        <section className="border-b border-border p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            What&apos;s it like right now?
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {(['working', 'busy', 'broken'] as const).map((s) => (
              <button
                key={s}
                data-testid={`report-${s}`}
                disabled={posting || (isSignedIn && !ready)}
                onClick={() => submit(s)}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-secondary px-2 py-3 text-sm font-medium text-foreground transition hover:border-foreground/30 active:scale-[0.98] disabled:opacity-50"
              >
                <span className={cn('size-3 rounded-full', STATUS_BG_CLASS[s])} />
                {STATUS_LABEL[s]}
                <span className="text-center text-[11px] font-normal leading-tight text-muted-foreground">{STATUS_HINT[s]}</span>
              </button>
            ))}
          </div>
          {isSignedIn ? (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Optional note — e.g. “stall 3 ICE’d”, “card reader down”"
              className="mt-3 text-base md:text-sm"
            />
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              <button onClick={onSignIn} className="font-medium text-primary underline-offset-2 hover:underline">
                Sign in
              </button>{' '}
              to report or vote. Reading is open to everyone.
            </p>
          )}
        </section>

        {/* 5. Live reports */}
        <section className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Live reports · expire after {REPORT_TTL_HOURS}h
          </h3>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has reported this station in the last {REPORT_TTL_HOURS} hours. Be the first.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="report-list">
              {reports.map((r) => {
                const mine = r.record.createdBy === userId
                const myVote = myVotes.get(r.record.recordId)?.data.vote
                const s = r.record.data.status
                return (
                  <li key={r.record.recordId} className={cn('rounded-lg border border-border bg-card p-3', r.disputed && 'opacity-60')}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_BG_CLASS[s])} />
                      <span className={cn('font-medium', STATUS_TEXT_CLASS[s])}>{STATUS_LABEL[s]}</span>
                      {r.disputed && (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-destructive">
                          Disputed
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{timeAgo(r.createdMs, now)}</span>
                    </div>
                    {r.record.data.note && <p className="mt-1.5 text-sm text-foreground/90">{r.record.data.note}</p>}
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {mine ? 'You' : (getName(r.record.createdBy) ?? 'A driver')} · {timeLeft(r.expiresMs, now)}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <VoteButton
                          label="Confirm"
                          count={r.confirms}
                          active={myVote === 'confirm'}
                          disabled={mine || (isSignedIn && !ready)}
                          onClick={() => vote(r, 'confirm')}
                          icon={<ThumbsUp className="size-4" />}
                        />
                        <VoteButton
                          label="Dispute"
                          count={r.disputes}
                          active={myVote === 'dispute'}
                          disabled={mine || (isSignedIn && !ready)}
                          onClick={() => vote(r, 'dispute')}
                          icon={<ThumbsDown className="size-4" />}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function FitBadge({ fit, vehicle }: { fit: ReturnType<typeof compat>; vehicle: Vehicle }) {
  const text = {
    direct: `Fits your ${vehicle.label}`,
    adapter: `Your ${vehicle.label} needs an adapter here`,
    none: `No plug here fits your ${vehicle.label}`,
    unknown: 'Plug types unknown — check before you go',
  }[fit]
  return (
    <p
      data-testid="fit-badge"
      className={cn(
        'mt-1.5 text-xs font-medium',
        fit === 'direct' && 'text-[var(--color-ev-working)]',
        fit === 'adapter' && 'text-[var(--color-ev-busy)]',
        (fit === 'none' || fit === 'unknown') && 'text-muted-foreground',
      )}
    >
      {text}
    </p>
  )
}

function NavLink({ href, label, testId }: { href: string; label: string; testId: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid={testId}
      className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-secondary px-2 text-center text-xs font-medium text-foreground hover:border-foreground/30"
    >
      {label}
    </a>
  )
}

function VoteButton(props: { label: string; count: number; active: boolean; disabled: boolean; onClick: () => void; icon: ReactNode }) {
  return (
    <Button
      size="sm"
      variant={props.active ? 'default' : 'outline'}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-pressed={props.active}
      title={props.disabled ? "You can't vote on your own report" : props.label}
      className="h-10 min-w-14 gap-1.5 px-3 text-sm"
    >
      {props.icon}
      <span className="sr-only">{props.label}</span>
      {props.count}
    </Button>
  )
}

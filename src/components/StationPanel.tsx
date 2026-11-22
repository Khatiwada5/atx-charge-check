/**
 * StationPanel — details for the selected station.
 *
 *   1. Header: name, network, fast/port info, current status, directions link.
 *   2. "Report now" — three big buttons (Working / Busy / Broken) + optional
 *      note. Signed-out visitors get a sign-in prompt instead.
 *      Posting replaces your own previous live report for this station, so
 *      one person can't flood a station with duplicates.
 *   3. Live reports, newest first, each with Confirm / Dispute buttons and a
 *      countdown to expiry. You can't vote on your own report; clicking your
 *      current vote again withdraws it.
 *
 * Writes are disabled until `useMutations().ready` (the realtime socket is
 * connected), per the DeepSpace rules.
 */

import { useState } from 'react'
import { useAuth, useMutations, useUserLookup, type RecordData } from 'deepspace'
import { BatteryCharging, Navigation2, ThumbsDown, ThumbsUp, X, Zap } from 'lucide-react'
import { Button, Textarea, useToast } from './ui'
import { cn } from '../lib/utils'
import type { Station } from '../lib/stations'
import {
  currentStatus,
  timeAgo,
  timeLeft,
  type ScoredReport,
  type StationStatus,
} from '../lib/station-status'
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

type Props = {
  station: Station
  reports: ScoredReport[]
  myVotes: Map<string, RecordData<Vote>>
  now: number
  onClose: () => void
  onSignIn: () => void
}

export default function StationPanel({ station, reports, myVotes, now, onClose, onSignIn }: Props) {
  const { isSignedIn, userId } = useAuth()
  const reportMut = useMutations<Report>('reports')
  const voteMut = useMutations<Vote>('votes')
  const { getName } = useUserLookup()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)

  const status = currentStatus(reports)
  const ready = reportMut.ready && voteMut.ready

  async function submit(next: ReportStatus) {
    if (!isSignedIn) return onSignIn()
    setPosting(true)
    try {
      // Replace my own earlier live report for this station, if any.
      for (const r of reports) {
        if (r.record.createdBy === userId) await reportMut.removeConfirmed(r.record.recordId)
      }
      await reportMut.createConfirmed({
        stationId: station.id,
        status: next,
        note: note.trim().slice(0, 200),
      })
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

  const directions = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`

  return (
    <div className="flex h-full flex-col" data-testid="station-panel">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug text-foreground">{station.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {station.network && <span>{station.network}</span>}
            {station.fast ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <Zap className="size-3" /> DC fast
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <BatteryCharging className="size-3" /> Level 2
              </span>
            )}
            {station.ports > 0 && <span>{station.ports} ports</span>}
          </p>
          <p className={cn('mt-2 text-sm font-medium', STATUS_TEXT_CLASS[status])} data-testid="station-status">
            {STATUS_LABEL[status]}
            {reports[0] && status !== 'unknown' && (
              <span className="font-normal text-muted-foreground"> · updated {timeAgo(reports[0].createdMs, now)}</span>
            )}
          </p>
        </div>
        <a
          href={directions}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Directions"
          title="Directions"
        >
          <Navigation2 className="size-4" />
        </a>
        <button
          onClick={onClose}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
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
                className="group flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-3 text-sm font-medium text-foreground transition hover:border-foreground/30 disabled:opacity-50"
              >
                <span className={cn('size-3 rounded-full', STATUS_BG_CLASS[s])} />
                {STATUS_LABEL[s]}
                <span className="text-center text-[11px] font-normal leading-tight text-muted-foreground">
                  {STATUS_HINT[s]}
                </span>
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
              className="mt-3 text-sm"
            />
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              <button onClick={onSignIn} className="text-primary underline-offset-2 hover:underline">
                Sign in
              </button>{' '}
              to report or vote. Reading is open to everyone.
            </p>
          )}
        </section>

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
                  <li
                    key={r.record.recordId}
                    className={cn(
                      'rounded-lg border border-border bg-card p-3',
                      r.disputed && 'opacity-60',
                    )}
                  >
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
                    {r.record.data.note && (
                      <p className="mt-1.5 text-sm text-foreground/90">{r.record.data.note}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {mine ? 'You' : (getName(r.record.createdBy) ?? 'A driver')} · {timeLeft(r.expiresMs, now)}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <VoteButton
                          label="Confirm"
                          count={r.confirms}
                          active={myVote === 'confirm'}
                          disabled={mine || (isSignedIn && !ready)}
                          onClick={() => vote(r, 'confirm')}
                          icon={<ThumbsUp className="size-3.5" />}
                        />
                        <VoteButton
                          label="Dispute"
                          count={r.disputes}
                          active={myVote === 'dispute'}
                          disabled={mine || (isSignedIn && !ready)}
                          onClick={() => vote(r, 'dispute')}
                          icon={<ThumbsDown className="size-3.5" />}
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

function VoteButton(props: {
  label: string
  count: number
  active: boolean
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={props.active ? 'default' : 'outline'}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-pressed={props.active}
      title={props.disabled ? "You can't vote on your own report" : props.label}
      className="h-7 gap-1 px-2 text-xs"
    >
      {props.icon}
      <span className="sr-only">{props.label}</span>
      {props.count}
    </Button>
  )
}

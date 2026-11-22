/**
 * Pure logic that turns raw reports + votes into "what's the status of this
 * station right now?". No React, no network — easy to unit test.
 *
 * Rules:
 *   - A report is live for REPORT_TTL_HOURS after the server stamped it.
 *   - Its score is 1 (the reporter) + confirms − disputes.
 *   - A report with score ≤ 0 is "disputed": still shown in the list, but it
 *     no longer drives the station's pin color.
 *   - The station's status is the NEWEST live, non-disputed report. Newest
 *     wins because chargers change state fast (a busy station frees up).
 */

import type { RecordData } from 'deepspace'
import { REPORT_TTL_MS, type Report, type ReportStatus } from '../schemas/reports-schema'
import type { Vote } from '../schemas/votes-schema'

export type StationStatus = ReportStatus | 'unknown'

export type ScoredReport = {
  record: RecordData<Report>
  confirms: number
  disputes: number
  score: number
  disputed: boolean
  createdMs: number
  expiresMs: number
}

export function isLive(createdAt: string, now: number): boolean {
  return now - new Date(createdAt).getTime() < REPORT_TTL_MS
}

/** Group live reports by station, newest first, with vote tallies attached. */
export function scoreReports(
  reports: RecordData<Report>[],
  votes: RecordData<Vote>[],
  now: number,
): Map<string, ScoredReport[]> {
  const tally = new Map<string, { c: number; d: number }>()
  for (const v of votes) {
    const t = tally.get(v.data.reportId) ?? { c: 0, d: 0 }
    if (v.data.vote === 'confirm') t.c++
    else t.d++
    tally.set(v.data.reportId, t)
  }

  const byStation = new Map<string, ScoredReport[]>()
  for (const r of reports) {
    if (!isLive(r.createdAt, now)) continue
    const t = tally.get(r.recordId) ?? { c: 0, d: 0 }
    const score = 1 + t.c - t.d
    const createdMs = new Date(r.createdAt).getTime()
    const scored: ScoredReport = {
      record: r,
      confirms: t.c,
      disputes: t.d,
      score,
      disputed: score <= 0,
      createdMs,
      expiresMs: createdMs + REPORT_TTL_MS,
    }
    const list = byStation.get(r.data.stationId) ?? []
    list.push(scored)
    byStation.set(r.data.stationId, list)
  }
  for (const list of byStation.values()) list.sort((a, b) => b.createdMs - a.createdMs)
  return byStation
}

export function currentStatus(list: ScoredReport[] | undefined): StationStatus {
  const top = list?.find((r) => !r.disputed)
  return top ? top.record.data.status : 'unknown'
}

export function timeAgo(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

export function timeLeft(expiresMs: number, now: number): string {
  const m = Math.max(0, Math.round((expiresMs - now) / 60000))
  if (m < 60) return `${m} min left`
  return `${Math.floor(m / 60)}h ${m % 60}m left`
}

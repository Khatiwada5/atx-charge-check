/**
 * Scheduled tasks — run by the AppCronRoom Durable Object (wired in worker.ts).
 *
 * `purge-expired` runs every 15 minutes and hard-deletes reports older than
 * REPORT_TTL_HOURS, plus every vote attached to them. The UI already hides
 * expired reports the instant they age out (it compares `createdAt` with the
 * clock), so this job is housekeeping: it keeps storage small and makes sure
 * stale reports never come back over the wire.
 *
 * buildCronContext runs as the app owner, so it bypasses RBAC — that's what
 * lets it delete other people's reports.
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import { REPORT_TTL_MS } from './schemas/reports-schema'

type Envelope = { recordId: string; createdAt: string; data: Record<string, unknown> }

type CronEnv = { OWNER_USER_ID: string; DEEPSPACE_APP_ID: string }

export const tasks: CronTask[] = [{ name: 'purge-expired', intervalMinutes: 15 }]

const PAGE = 500

export async function runTask(name: string, env: unknown): Promise<void> {
  if (name !== 'purge-expired') return
  const e = env as CronEnv
  const ctx = buildCronContext(env as never, e.OWNER_USER_ID, `app:${e.DEEPSPACE_APP_ID}`)
  const cutoff = Date.now() - REPORT_TTL_MS

  const reports = (await ctx.records.query('reports', { limit: PAGE })) as Envelope[]
  const expired = new Set(
    reports.filter((r) => new Date(r.createdAt).getTime() < cutoff).map((r) => r.recordId),
  )
  const live = new Set(reports.map((r) => r.recordId).filter((id) => !expired.has(id)))

  for (const id of expired) await ctx.records.delete('reports', id)

  // Remove votes whose report is gone (expired now, or deleted by its author).
  // If the report page was full we can't see every live report, so skip this
  // pass rather than risk deleting votes on a report we didn't load.
  if (reports.length >= PAGE) return
  const votes = (await ctx.records.query('votes', { limit: PAGE * 4 })) as Envelope[]
  let orphaned = 0
  for (const v of votes) {
    if (!live.has(String(v.data.reportId))) {
      await ctx.records.delete('votes', v.recordId)
      orphaned++
    }
  }

  console.log(`[purge-expired] removed ${expired.size} reports, ${orphaned} votes`)
}

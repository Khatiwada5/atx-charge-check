/**
 * `reports` — one row per driver report about a charging station.
 *
 * A report says a station is `working`, `busy` (all ports occupied), or
 * `broken`. Reports expire REPORT_TTL_HOURS after they were created: the UI
 * hides older ones immediately, and the `purge-expired` cron task in
 * src/cron.ts deletes them from storage.
 *
 * Expiry is computed from the envelope's server-stamped `createdAt`, not from
 * a client-supplied field, so nobody can post a report that lives forever.
 *
 * Permissions: anyone (even signed-out visitors, the `'*'` role) can read, so
 * the map works without an account. Only signed-in members can post, and only
 * the author can edit or delete their own report. Admins can moderate.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const REPORT_STATUSES = ['working', 'busy', 'broken'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REPORT_TTL_HOURS = 3
export const REPORT_TTL_MS = REPORT_TTL_HOURS * 60 * 60 * 1000

export type Report = {
  stationId: string
  status: ReportStatus
  note: string
}

export const reportsSchema: CollectionSchema = {
  name: 'reports',
  columns: [
    { name: 'stationId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: [...REPORT_STATUSES] },
      required: true,
    },
    { name: 'note', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

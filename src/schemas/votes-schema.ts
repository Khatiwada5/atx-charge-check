/**
 * `votes` — other drivers confirming or disputing a report.
 *
 * The server enforces "one vote per person per report":
 *   - `userId` is `userBound`, so the Durable Object stamps it with the
 *     caller's verified id — a client can't vote as someone else.
 *   - `uniqueOn: ['reportId', 'userId']` refuses a second row for the same
 *     pair, so ballot-stuffing fails even with a hand-crafted WebSocket frame.
 * Changing your mind is an update of your own row (confirm ⇄ dispute).
 *
 * Votes are deleted along with their report by the cron purge.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const VOTE_KINDS = ['confirm', 'dispute'] as const
export type VoteKind = (typeof VOTE_KINDS)[number]

export type Vote = {
  reportId: string
  userId: string
  vote: VoteKind
}

export const votesSchema: CollectionSchema = {
  name: 'votes',
  columns: [
    { name: 'reportId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    {
      name: 'vote',
      storage: 'text',
      interpretation: { kind: 'select', options: [...VOTE_KINDS] },
      required: true,
    },
  ],
  uniqueOn: ['reportId', 'userId'],
  ownerField: 'userId',
  permissions: {
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

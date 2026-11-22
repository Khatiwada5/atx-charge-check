import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import { currentStatus, scoreReports } from './station-status'
import { REPORT_TTL_MS, type Report } from '../schemas/reports-schema'
import type { Vote } from '../schemas/votes-schema'

const NOW = Date.parse('2026-11-21T18:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

function report(id: string, status: Report['status'], minAgo: number, station = 's1'): RecordData<Report> {
  return { recordId: id, data: { stationId: station, status, note: '' }, createdBy: 'u-' + id, createdAt: ago(minAgo), updatedAt: ago(minAgo) }
}
function vote(reportId: string, user: string, kind: Vote['vote']): RecordData<Vote> {
  return { recordId: `${reportId}-${user}`, data: { reportId, userId: user, vote: kind }, createdBy: user, createdAt: ago(0), updatedAt: ago(0) }
}

describe('station status', () => {
  it('is unknown with no reports', () => {
    expect(currentStatus(scoreReports([], [], NOW).get('s1'))).toBe('unknown')
  })

  it('uses the newest live report', () => {
    const m = scoreReports([report('a', 'broken', 60), report('b', 'working', 5)], [], NOW)
    expect(currentStatus(m.get('s1'))).toBe('working')
  })

  it('drops reports past the TTL', () => {
    const m = scoreReports([report('a', 'broken', REPORT_TTL_MS / 60_000 + 1)], [], NOW)
    expect(m.get('s1')).toBeUndefined()
  })

  it('ignores a disputed report and falls back to the next one', () => {
    const m = scoreReports(
      [report('old', 'busy', 30), report('new', 'broken', 2)],
      [vote('new', 'x', 'dispute'), vote('new', 'y', 'dispute')],
      NOW,
    )
    const list = m.get('s1')!
    expect(list[0].disputed).toBe(true)
    expect(currentStatus(list)).toBe('busy')
  })

  it('confirms offset disputes', () => {
    const m = scoreReports(
      [report('r', 'broken', 2)],
      [vote('r', 'x', 'dispute'), vote('r', 'y', 'confirm')],
      NOW,
    )
    expect(m.get('s1')![0].score).toBe(1)
    expect(currentStatus(m.get('s1'))).toBe('broken')
  })
})

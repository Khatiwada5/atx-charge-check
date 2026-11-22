/**
 * GET /api/traffic?from=lat,lng&to=lat,lng — live traffic for a drive.
 *
 * The worker holds the TomTom key (`TOMTOM_API_KEY`, set with
 * `deepspace secrets set` / scripts/set-tomtom-key.sh) so it never reaches the
 * browser or the repo. Guards for the free-tier quota (2,500 requests/day):
 *   - only Austin-area coordinates are accepted
 *   - answers are cached per ~100 m origin/destination cell for 90 s
 * Without a key it answers `{ available: false }` and the app falls back to
 * typical-speed travel times.
 */

import type { Hono } from 'hono'
import type { AppContext } from '../../worker.js'
import { parseTomTom, tomtomUrl, type TrafficResponse } from '../lib/traffic.js'
import type { LatLng } from '../lib/geo.js'

const CACHE_MS = 90_000
const cache = new Map<string, { at: number; body: TrafficResponse }>()

// Greater Austin, generously: Georgetown ↔ San Marcos, Bastrop ↔ Dripping Springs.
const inArea = ([lat, lng]: LatLng) => lat > 29.6 && lat < 31.0 && lng > -98.6 && lng < -97.0

function parse(v: string | undefined): LatLng | null {
  const m = v?.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)$/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

export function registerTrafficRoutes(app: Hono<AppContext>): void {
  app.get('/api/traffic', async (c) => {
    const from = parse(c.req.query('from'))
    const to = parse(c.req.query('to'))
    if (!from || !to || !inArea(from) || !inArea(to)) {
      return c.json({ available: false, reason: 'bad_coordinates' } satisfies TrafficResponse, 400)
    }
    const key = c.env.TOMTOM_API_KEY
    if (!key) return c.json({ available: false, reason: 'not_configured' } satisfies TrafficResponse)

    const cell = (p: LatLng) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`
    const id = `${cell(from)}>${cell(to)}`
    const hit = cache.get(id)
    if (hit && Date.now() - hit.at < CACHE_MS) return c.json(hit.body)

    let body: TrafficResponse
    try {
      const res = await fetch(tomtomUrl(from, to, key), { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        // Never log the URL: it carries the key.
        console.log(`[traffic] TomTom answered ${res.status}`)
        body = { available: false, reason: `tomtom_${res.status}` }
      } else {
        body = parseTomTom(await res.json()) ?? { available: false, reason: 'no_route' }
      }
    } catch (e) {
      console.log(`[traffic] TomTom request failed: ${e instanceof Error ? e.name : 'error'}`)
      body = { available: false, reason: 'tomtom_unreachable' }
    }

    if (cache.size > 500) cache.clear()
    cache.set(id, { at: Date.now(), body })
    return c.json(body)
  })
}

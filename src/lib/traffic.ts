/**
 * Live traffic from TomTom's Routing API, shared by the worker (which calls
 * TomTom with the secret key) and the browser (which calls our worker).
 *
 * Turn-by-turn steps and lanes still come from OSRM; TomTom only supplies
 * what OSRM can't: travel time with current traffic, the delay versus free
 * flow, and where the slowdowns are (drawn orange/red on the route).
 */

import type { LatLng } from './geo'

export type JamLevel = 'slow' | 'heavy' | 'closed'
export type Jam = { coords: LatLng[]; level: JamLevel; delayS: number }

export type Traffic = {
  available: true
  travelTimeS: number
  noTrafficS: number
  delayS: number
  lengthM: number
  jams: Jam[]
}
export type TrafficResponse = Traffic | { available: false; reason: string }

/** The bits of TomTom's calculateRoute response we read. */
type TomTomRoute = {
  summary: {
    lengthInMeters: number
    travelTimeInSeconds: number
    trafficDelayInSeconds?: number
    noTrafficTravelTimeInSeconds?: number
  }
  legs: { points: { latitude: number; longitude: number }[] }[]
  sections?: {
    sectionType: string
    startPointIndex: number
    endPointIndex: number
    simpleCategory?: string
    magnitudeOfDelay?: number
    delayInSeconds?: number
  }[]
}

export function tomtomUrl(from: LatLng, to: LatLng, key: string): string {
  return (
    `https://api.tomtom.com/routing/1/calculateRoute/${from[0]},${from[1]}:${to[0]},${to[1]}/json` +
    `?key=${encodeURIComponent(key)}&traffic=true&travelMode=car&routeType=fastest` +
    `&sectionType=traffic&computeTravelTimeFor=all`
  )
}

/** magnitudeOfDelay: 1 minor, 2 moderate, 3 major, 4 undefined (closures). */
function level(category: string | undefined, magnitude: number | undefined): JamLevel {
  if (category === 'ROAD_CLOSURE' || magnitude === 4) return 'closed'
  if ((magnitude ?? 0) >= 3) return 'heavy'
  return 'slow'
}

export function parseTomTom(body: { routes?: TomTomRoute[] }): Traffic | null {
  const r = body.routes?.[0]
  if (!r) return null
  const points: LatLng[] = r.legs.flatMap((l) => l.points.map((p) => [p.latitude, p.longitude] as LatLng))
  const s = r.summary
  const delayS = Math.max(0, s.trafficDelayInSeconds ?? 0)
  return {
    available: true,
    travelTimeS: s.travelTimeInSeconds,
    noTrafficS: s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - delayS,
    delayS,
    lengthM: s.lengthInMeters,
    jams: (r.sections ?? [])
      .filter((x) => x.sectionType === 'TRAFFIC' && x.endPointIndex > x.startPointIndex)
      .map((x) => ({
        coords: points.slice(x.startPointIndex, x.endPointIndex + 1),
        level: level(x.simpleCategory, x.magnitudeOfDelay),
        delayS: x.delayInSeconds ?? 0,
      })),
  }
}

/** How much slower than OSRM's typical-speed estimate traffic makes the trip. */
export function trafficFactor(t: Traffic | null, osrmDurationS: number): number {
  if (!t || osrmDurationS <= 0) return 1
  return Math.min(3, Math.max(0.7, t.travelTimeS / osrmDurationS))
}

/** Google-style color for the ETA: green, amber (> 3 min late), red (> 10 min). */
export function delayTone(delayS: number): 'ok' | 'slow' | 'heavy' {
  if (delayS > 600) return 'heavy'
  if (delayS > 180) return 'slow'
  return 'ok'
}

/** Browser side: ask our worker. Never throws — traffic is optional. */
export async function fetchTraffic(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Traffic | null> {
  try {
    const q = `from=${from[0].toFixed(5)},${from[1].toFixed(5)}&to=${to[0].toFixed(5)},${to[1].toFixed(5)}`
    const res = await fetch(`/api/traffic?${q}`, { signal })
    if (!res.ok) return null
    const body = (await res.json()) as TrafficResponse
    return body.available ? body : null
  } catch {
    return null
  }
}

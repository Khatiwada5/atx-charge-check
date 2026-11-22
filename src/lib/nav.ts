/**
 * Turn-by-turn navigation math. Pure functions, no React, no browser APIs,
 * so it's all unit-tested (nav.test.ts).
 *
 * Given a Route (line + OSRM steps) and a GPS fix, `progress()` answers:
 *   - how far along the route are we (snapping the fix onto the line)
 *   - how far off the line are we (→ reroute when too far)
 *   - which maneuver is next, how far to it, and what to say
 *   - distance and time remaining
 *
 * Units: OSRM step distances are the source of truth for "along" distances;
 * the drawn polyline is scaled to match them so the two never disagree.
 */

import type { LatLng, Route, Step } from './geo'

const R = 6371e3
const rad = (d: number) => (d * Math.PI) / 180

/** Local flat-earth projection in meters around `origin` — accurate at city scale. */
function toXY(p: LatLng, origin: LatLng): [number, number] {
  return [rad(p[1] - origin[1]) * R * Math.cos(rad(origin[0])), rad(p[0] - origin[0]) * R]
}

export type RouteIndex = {
  route: Route
  /** Cumulative along-distance (OSRM meters) at each polyline vertex. */
  cum: number[]
  /** Along-distance at which each step's maneuver happens. */
  maneuverAt: number[]
}

export function indexRoute(route: Route): RouteIndex {
  const raw = [0]
  for (let i = 1; i < route.coords.length; i++) raw.push(raw[i - 1] + segLen(route.coords[i - 1], route.coords[i]))
  const polyLen = raw[raw.length - 1] || 1
  const scale = route.distanceM / polyLen
  const cum = raw.map((d) => d * scale)
  const maneuverAt: number[] = []
  let acc = 0
  for (const s of route.steps) {
    maneuverAt.push(acc)
    acc += s.distanceM
  }
  return { route, cum, maneuverAt }
}

function segLen(a: LatLng, b: LatLng) {
  const [x, y] = toXY(b, a)
  return Math.hypot(x, y)
}

export type Snap = { seg: number; along: number; offM: number; point: LatLng }

/**
 * Snap a GPS fix onto the route. `hint` (the last snapped segment) keeps the
 * search local and forward-biased so the dot doesn't jump back onto an
 * earlier, nearby part of the route (loops, frontage roads).
 */
export function snap(idx: RouteIndex, pos: LatLng, hint = 0): Snap {
  const c = idx.route.coords
  const search = (from: number, to: number) => {
    let best: Snap = { seg: 0, along: 0, offM: Infinity, point: c[0] }
    for (let i = Math.max(0, from); i < Math.min(c.length - 1, to); i++) {
      const [ax, ay] = [0, 0]
      const [bx, by] = toXY(c[i + 1], c[i])
      const [px, py] = toXY(pos, c[i])
      const len2 = bx * bx + by * by
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2))
      const off = Math.hypot(px - t * bx, py - t * by)
      if (off < best.offM) {
        const along = idx.cum[i] + t * (idx.cum[i + 1] - idx.cum[i])
        best = { seg: i, along, offM: off, point: [c[i][0] + t * (c[i + 1][0] - c[i][0]), c[i][1] + t * (c[i + 1][1] - c[i][1])] }
      }
    }
    return best
  }
  const local = search(hint - 3, hint + 80)
  return local.offM < 60 ? local : search(0, c.length)
}

export type Progress = {
  snap: Snap
  /** Index into route.steps of the NEXT maneuver, or -1 once arrived. */
  next: number
  toNextM: number
  remainingM: number
  remainingS: number
  arrived: boolean
  offRoute: boolean
}

export const ARRIVE_M = 35
export const OFF_ROUTE_M = 45

export function progress(idx: RouteIndex, pos: LatLng, hint = 0, accuracyM = 0): Progress {
  const s = snap(idx, pos, hint)
  const { route, maneuverAt } = idx
  const remainingM = Math.max(0, route.distanceM - s.along)
  const arrived = remainingM < ARRIVE_M
  let next = maneuverAt.findIndex((a, k) => k > 0 && a > s.along + 1)
  if (arrived) next = -1
  else if (next === -1) next = route.steps.length - 1

  // Time left: the rest of the current step (pro-rated) + every later step.
  let remainingS = 0
  if (!arrived && next > 0) {
    const cur = route.steps[next - 1]
    const toNextM = maneuverAt[next] - s.along
    remainingS += cur.distanceM > 0 ? (cur.durationS * toNextM) / cur.distanceM : 0
    for (let k = next; k < route.steps.length; k++) remainingS += route.steps[k].durationS
  }

  return {
    snap: s,
    next,
    toNextM: next >= 0 ? Math.max(0, maneuverAt[next] - s.along) : 0,
    remainingM,
    remainingS,
    arrived,
    offRoute: s.offM > Math.max(OFF_ROUTE_M, accuracyM * 1.5),
  }
}

/** Compass bearing in degrees from a to b (0 = north, 90 = east). */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]))
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

function road(step: Step): string {
  return step.name || step.ref || ''
}

/** Human instruction for a step's maneuver, e.g. "Turn left onto West 6th Street". */
export function instruction(step: Step): string {
  const m = step.maneuver
  const mod = m.modifier ?? ''
  const onto = road(step) ? ` onto ${road(step)}` : ''
  switch (m.type) {
    case 'depart':
      return `Head ${COMPASS[Math.round(m.bearingAfter / 45) % 8]}${road(step) ? ` on ${road(step)}` : ''}`
    case 'arrive':
      return mod && mod !== 'straight' ? `Your destination is on the ${mod.includes('left') ? 'left' : 'right'}` : 'You have arrived'
    case 'roundabout':
    case 'rotary':
      return m.exit ? `At the roundabout, take exit ${m.exit}${onto}` : `Enter the roundabout${onto}`
    case 'merge':
      return `Merge${mod ? ` ${mod.replace('slight ', '')}` : ''}${onto}`
    case 'on ramp':
      return `Take the ramp${mod ? ` on the ${mod.includes('left') ? 'left' : 'right'}` : ''}${onto}`
    case 'off ramp':
      return `Take the exit${mod ? ` on the ${mod.includes('left') ? 'left' : 'right'}` : ''}${onto}`
    case 'fork':
      return `Keep ${mod.includes('left') ? 'left' : 'right'} at the fork${onto}`
    case 'end of road':
      return `At the end of the road, turn ${mod.includes('left') ? 'left' : 'right'}${onto}`
    case 'new name':
    case 'continue':
      return mod === 'uturn' ? 'Make a U-turn' : `Continue${onto || ' straight'}`
    default:
      if (mod === 'uturn') return 'Make a U-turn'
      if (mod === 'straight') return `Continue straight${onto}`
      return `Turn ${mod || 'ahead'}${onto}`
  }
}

/** Distance as a driver hears it: "500 ft", "0.3 mi", "12 mi". */
export function navDistance(m: number): string {
  const ft = m * 3.281
  if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} ft`
  const mi = m / 1609.344
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

/** Spoken form: "In 500 feet, turn left onto Lamar Boulevard". */
export function spoken(step: Step, distM: number | null): string {
  const text = instruction(step)
  if (distM == null) return text
  const d = navDistance(distM).replace(' ft', ' feet').replace(' mi', ' miles')
  return `In ${d}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/**
 * Lane advice for a maneuver, e.g. "Use the right lane", "Use the left 2
 * lanes". Null when lanes aren't mapped or every lane works (nothing to say).
 */
export function laneAdvice(step: Step): string | null {
  const lanes = step.lanes
  if (!lanes || lanes.length < 2) return null
  const ok = lanes.map((l, i) => (l.valid ? i : -1)).filter((i) => i >= 0)
  if (ok.length === 0 || ok.length === lanes.length) return null
  const n = ok.length
  const contiguous = ok[n - 1] - ok[0] === n - 1
  if (!contiguous) return null
  const word = n === 1 ? 'lane' : `${n} lanes`
  if (ok[0] === 0) return n === 1 ? 'Use the left lane' : `Use the left ${word}`
  if (ok[n - 1] === lanes.length - 1) return n === 1 ? 'Use the right lane' : `Use the right ${word}`
  return n === 1 ? 'Use the middle lane' : `Use the middle ${word}`
}

/** Spoken form with lane advice: "In 500 feet, use the right lane to turn right onto …". */
export function spokenWithLanes(step: Step, distM: number | null): string {
  const lane = laneAdvice(step)
  const base = spoken(step, distM)
  if (!lane) return base
  const text = instruction(step)
  const action = `${lane.toLowerCase()} to ${text.charAt(0).toLowerCase()}${text.slice(1)}`
  if (distM == null) return action.charAt(0).toUpperCase() + action.slice(1)
  const d = navDistance(distM).replace(' ft', ' feet').replace(' mi', ' miles')
  return `In ${d}, ${action}`
}

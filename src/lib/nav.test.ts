import { describe, expect, it } from 'vitest'
import { bearing, indexRoute, instruction, navDistance, progress, spoken } from './nav'
import type { LatLng, Route, Step } from './geo'

// An L-shaped route: ~1 km north, then ~1 km east.
const A: LatLng = [30.26, -97.75]
const B: LatLng = [30.269, -97.75]
const C: LatLng = [30.269, -97.7396]

function step(type: string, loc: LatLng, distanceM: number, name: string, modifier?: string, bearingAfter = 0): Step {
  return { name, distanceM, durationS: distanceM / 10, maneuver: { type, modifier, location: loc, bearingAfter } }
}

const route: Route = {
  coords: [A, [30.2645, -97.75], B, [30.269, -97.745], C],
  distanceM: 2000,
  durationS: 200,
  steps: [
    step('depart', A, 1000, 'Lamar Boulevard', undefined, 0),
    step('turn', B, 1000, 'West 6th Street', 'right', 90),
    step('arrive', C, 0, 'West 6th Street', 'left'),
  ],
}
const idx = indexRoute(route)

describe('navigation progress', () => {
  it('at the start: next is the right turn ~1 km ahead', () => {
    const p = progress(idx, A)
    expect(p.next).toBe(1)
    expect(p.toNextM).toBeGreaterThan(950)
    expect(p.remainingM).toBeGreaterThan(1950)
    expect(p.offRoute).toBe(false)
  })

  it('halfway up the first leg: ~500 m to the turn, ~150 s left', () => {
    const p = progress(idx, [30.2645, -97.75])
    expect(p.next).toBe(1)
    expect(p.toNextM).toBeGreaterThan(450)
    expect(p.toNextM).toBeLessThan(550)
    expect(p.remainingS).toBeGreaterThan(140)
    expect(p.remainingS).toBeLessThan(160)
  })

  it('after the turn: next is the arrival', () => {
    const p = progress(idx, [30.269, -97.745])
    expect(p.next).toBe(2)
    expect(route.steps[p.next].maneuver.type).toBe('arrive')
  })

  it('snaps a slightly-off GPS fix onto the road', () => {
    const p = progress(idx, [30.2645, -97.7502]) // ~20 m west
    expect(p.offRoute).toBe(false)
    expect(p.snap.offM).toBeGreaterThan(10)
  })

  it('flags off-route when far from the line', () => {
    expect(progress(idx, [30.2645, -97.7525]).offRoute).toBe(true) // ~240 m west
  })

  it('detects arrival near the destination', () => {
    const p = progress(idx, C, 3)
    expect(p.arrived).toBe(true)
    expect(p.next).toBe(-1)
  })
})

describe('instructions', () => {
  it('reads like a navigation app', () => {
    expect(instruction(route.steps[0])).toBe('Head north on Lamar Boulevard')
    expect(instruction(route.steps[1])).toBe('Turn right onto West 6th Street')
    expect(instruction(route.steps[2])).toBe('Your destination is on the left')
    expect(spoken(route.steps[1], 152)).toBe('In 500 feet, turn right onto West 6th Street')
  })

  it('formats distances in feet then miles', () => {
    expect(navDistance(30)).toBe('100 ft')
    expect(navDistance(800)).toBe('0.5 mi')
    expect(navDistance(25000)).toBe('16 mi')
  })

  it('computes compass bearings', () => {
    expect(Math.round(bearing(A, B))).toBe(0)
    expect(Math.round(bearing(B, C))).toBe(90)
  })
})

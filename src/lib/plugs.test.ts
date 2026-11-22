import { describe, expect, it } from 'vitest'
import { compat, hasFastFor, plugFit, VEHICLE_BY_ID } from './plugs'
import type { Station } from './stations'

const st = (plugs: Station['plugs']): Station => ({ id: 'x', name: 'x', lat: 0, lng: 0, network: '', fast: false, ports: 0, plugs })

const taycan = VEHICLE_BY_ID.get('porsche-taycan')!
const model3 = VEHICLE_BY_ID.get('tesla-3')!
const leaf = VEHICLE_BY_ID.get('nissan-leaf')!

describe('plug compatibility', () => {
  it('a Taycan (CCS1) plugs straight into J1772 and CCS1', () => {
    expect(compat(st({ j1772: 2 }), taycan.port)).toBe('direct')
    expect(compat(st({ ccs1: 1 }), taycan.port)).toBe('direct')
  })

  it('a Taycan needs an adapter at a Tesla-only station', () => {
    expect(compat(st({ nacs_dc: 8 }), taycan.port)).toBe('adapter')
    expect(plugFit('nacs_dc', taycan.port).note).toMatch(/Supercharger access/)
  })

  it('a Tesla fits Superchargers directly and J1772 with its adapter', () => {
    expect(compat(st({ nacs_dc: 12 }), model3.port)).toBe('direct')
    expect(compat(st({ j1772: 2 }), model3.port)).toBe('adapter')
  })

  it('nothing at a CHAdeMO-only station fits a Tesla', () => {
    expect(compat(st({ chademo: 1 }), model3.port)).toBe('none')
  })

  it('a Leaf can use a Tesla destination charger with an adapter, never a Supercharger', () => {
    expect(compat(st({ nacs_ac: 2 }), leaf.port)).toBe('adapter')
    expect(compat(st({ nacs_dc: 2 }), leaf.port)).toBe('none')
  })

  it('reports unknown when a station has no plug data', () => {
    expect(compat(st({}), taycan.port)).toBe('unknown')
  })

  it('DC-fast filter respects the car', () => {
    const sc = st({ nacs_dc: 8 })
    expect(hasFastFor(sc, null)).toBe(true)
    expect(hasFastFor(sc, model3.port)).toBe(true)
    expect(hasFastFor(sc, leaf.port)).toBe(false)
    expect(hasFastFor(st({ j1772: 4 }), null)).toBe(false)
  })
})

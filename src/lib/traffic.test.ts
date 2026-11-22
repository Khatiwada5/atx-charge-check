import { describe, expect, it } from 'vitest'
import { delayTone, parseTomTom, tomtomUrl, trafficFactor } from './traffic'

// Shaped like TomTom's calculateRoute response (sectionType=traffic).
const sample = {
  routes: [
    {
      summary: { lengthInMeters: 18000, travelTimeInSeconds: 1500, trafficDelayInSeconds: 300, noTrafficTravelTimeInSeconds: 1200 },
      legs: [
        {
          points: [
            { latitude: 30.26, longitude: -97.74 },
            { latitude: 30.27, longitude: -97.74 },
            { latitude: 30.28, longitude: -97.74 },
            { latitude: 30.29, longitude: -97.74 },
          ],
        },
      ],
      sections: [
        { sectionType: 'TRAVEL_MODE', startPointIndex: 0, endPointIndex: 3 },
        { sectionType: 'TRAFFIC', startPointIndex: 0, endPointIndex: 1, simpleCategory: 'JAM', magnitudeOfDelay: 1, delayInSeconds: 40 },
        { sectionType: 'TRAFFIC', startPointIndex: 1, endPointIndex: 2, simpleCategory: 'JAM', magnitudeOfDelay: 3, delayInSeconds: 200 },
        { sectionType: 'TRAFFIC', startPointIndex: 2, endPointIndex: 3, simpleCategory: 'ROAD_CLOSURE', magnitudeOfDelay: 4 },
      ],
    },
  ],
}

describe('TomTom traffic', () => {
  it('reads travel time, delay and jam sections', () => {
    const t = parseTomTom(sample)!
    expect(t.travelTimeS).toBe(1500)
    expect(t.delayS).toBe(300)
    expect(t.noTrafficS).toBe(1200)
    expect(t.jams.map((j) => j.level)).toEqual(['slow', 'heavy', 'closed'])
    expect(t.jams[1].coords).toEqual([[30.27, -97.74], [30.28, -97.74]])
  })

  it('returns null without a route', () => {
    expect(parseTomTom({ routes: [] })).toBeNull()
  })

  it('scales OSRM estimates by traffic, within sane bounds', () => {
    const t = parseTomTom(sample)!
    expect(trafficFactor(t, 1000)).toBe(1.5)
    expect(trafficFactor(t, 100)).toBe(3)
    expect(trafficFactor(null, 1000)).toBe(1)
  })

  it('colors the ETA like the maps apps', () => {
    expect(delayTone(60)).toBe('ok')
    expect(delayTone(300)).toBe('slow')
    expect(delayTone(900)).toBe('heavy')
  })

  it('builds the request with traffic on and the key encoded', () => {
    const u = tomtomUrl([30.1, -97.7], [30.2, -97.8], 'a b')
    expect(u).toContain('/calculateRoute/30.1,-97.7:30.2,-97.8/json')
    expect(u).toContain('key=a%20b')
    expect(u).toContain('traffic=true')
    expect(u).toContain('sectionType=traffic')
  })
})

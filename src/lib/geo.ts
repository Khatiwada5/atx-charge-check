/**
 * Location helpers: distance, "open in Google / Apple Maps" links, and the
 * in-app driving route preview.
 *
 * Routes come from the public OSRM demo router (router.project-osrm.org):
 * free and keyless, a shared demo server. We ask for the full line plus
 * turn-by-turn steps, which drive the in-app navigation mode (src/lib/nav.ts).
 * Google / Apple Maps hand-off links are the fallback.
 */

export type LatLng = [number, number]

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371e3
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function formatMiles(m: number): string {
  const mi = m / 1609.344
  return mi < 0.1 ? `${Math.round(m * 3.281)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

export function formatDuration(s: number): string {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * Google Maps universal link. On a phone with the app installed it opens the
 * app; `dir_action=navigate` starts turn-by-turn immediately. Origin is left
 * out so Google uses the phone's live location.
 */
export function googleMapsUrl(dest: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest[0]},${dest[1]}&travelmode=driving&dir_action=navigate`
}

/** Apple Maps link: opens the Maps app on iPhone/Mac with driving directions. */
export function appleMapsUrl(dest: LatLng, name: string): string {
  return `https://maps.apple.com/?daddr=${dest[0]},${dest[1]}&dirflg=d&q=${encodeURIComponent(name)}`
}

export type Maneuver = {
  type: string
  modifier?: string
  exit?: number
  bearingAfter: number
  location: LatLng
}

/** One lane at the maneuver: its painted arrows, and whether it leads where we're going. */
export type Lane = { indications: string[]; valid: boolean }

/**
 * One turn-by-turn step: do `maneuver` at its location, then drive
 * `distanceM` along `name`. `lanes` (left → right) comes from OpenStreetMap
 * turn:lanes tags and is missing where nobody has mapped them.
 */
export type Step = { name: string; ref?: string; distanceM: number; durationS: number; maneuver: Maneuver; lanes?: Lane[] }

export type Route = { coords: LatLng[]; distanceM: number; durationS: number; steps: Step[] }

type OsrmStep = {
  name: string
  ref?: string
  distance: number
  duration: number
  maneuver: { type: string; modifier?: string; exit?: number; bearing_after: number; location: [number, number] }
  intersections?: { lanes?: Lane[] }[]
}

export async function fetchRoute(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}` +
    `?overview=full&geometries=geojson&steps=true`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Routing service answered ${res.status}`)
  const body = (await res.json()) as {
    code: string
    routes?: {
      distance: number
      duration: number
      geometry: { coordinates: [number, number][] }
      legs: { steps: OsrmStep[] }[]
    }[]
  }
  const r = body.routes?.[0]
  if (body.code !== 'Ok' || !r) throw new Error('No driving route found')
  return {
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceM: r.distance,
    durationS: r.duration,
    steps: r.legs.flatMap((l) =>
      l.steps.map((st) => ({
        name: st.name,
        ref: st.ref,
        distanceM: st.distance,
        durationS: st.duration,
        maneuver: {
          type: st.maneuver.type,
          modifier: st.maneuver.modifier,
          exit: st.maneuver.exit,
          bearingAfter: st.maneuver.bearing_after,
          location: [st.maneuver.location[1], st.maneuver.location[0]] as LatLng,
        },
        lanes: st.intersections?.[0]?.lanes,
      })),
    ),
  }
}

/** Promise wrapper around the browser's one-shot location request. */
export function getLocation(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available in this browser'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location permission was denied. Allow it in your browser settings to see routes.'
              : 'Could not get your location.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

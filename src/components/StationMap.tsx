/**
 * StationMap — the Leaflet map of Austin with one pin per charging station.
 *
 * Pin color = the station's current crowd-reported status (green working,
 * amber busy, red broken, gray no recent reports). Fast (DC) chargers get a
 * larger pin. When a car is chosen, stations it can only use WITH AN ADAPTER
 * get a hollow, dashed pin so "plugs straight in" stands out.
 *
 * Also draws: your location (blue dot) and the driving-route preview line to
 * the selected station, and zooms to fit that route.
 *
 * Tiles: Esri's "World Dark Gray Canvas" basemap + its label layer — free,
 * no API key, attribution shown bottom-right. Pins sit above both layers.
 */

import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { NavFrame } from './NavigationView'
import type { Station } from '../lib/stations'
import type { StationStatus } from '../lib/station-status'
import type { LatLng } from '../lib/geo'

// Hex, not CSS vars: pins draw on a <canvas> (preferCanvas, fast with 500+
// markers) and canvas can't resolve var(). Keep in sync with themes.css.
export const STATUS_COLOR: Record<StationStatus, string> = {
  working: '#34d399',
  busy: '#f2b134',
  broken: '#ef5350',
  unknown: '#6b7280',
}

const AUSTIN: LatLng = [30.2747, -97.7404]

type Props = {
  stations: Station[]
  statusOf: (id: string) => StationStatus
  needsAdapter: (id: string) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  flyTo: LatLng | null
  userLoc: LatLng | null
  route: LatLng[] | null
  /** Turn-by-turn mode: follow this position, draw what's left of the route. */
  nav: NavFrame | null
  following: boolean
  onUserPan: () => void
}

export default function StationMap(props: Props) {
  const { stations, statusOf, needsAdapter, selectedId, onSelect, flyTo, userLoc, route, nav, following, onUserPan } = props
  const line = nav ? nav.path : route
  return (
    <MapContainer
      center={AUSTIN}
      zoom={12}
      minZoom={10}
      preferCanvas
      className="h-full w-full"
      attributionControl
      zoomControl={false}
    >
      <ZoomControl position="bottomright" />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution='Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · Stations: <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routes: OSRM'
        maxZoom={19}
        maxNativeZoom={16}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
        maxNativeZoom={16}
      />
      <FlyTo target={nav ? null : flyTo} />
      <FitRoute route={nav ? null : route} />
      <FollowCam frame={nav} following={following} onUserPan={onUserPan} />

      {line && (
        <>
          <Polyline positions={line} pathOptions={{ color: '#0b0d0f', weight: nav ? 12 : 9, opacity: 0.8 }} />
          <Polyline positions={line} pathOptions={{ color: '#4f9dff', weight: nav ? 8 : 5, opacity: 0.95 }} />
        </>
      )}

      {/* Unknown pins first so reported stations draw on top of them. */}
      {[...stations]
        .sort((a, b) => rank(statusOf(a.id)) - rank(statusOf(b.id)))
        .map((s) => {
          const status = statusOf(s.id)
          const selected = s.id === selectedId
          const adapter = needsAdapter(s.id)
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lng]}
              radius={selected ? 11 : s.fast ? 7 : 5}
              pathOptions={{
                color: selected ? '#ffffff' : adapter ? STATUS_COLOR[status] : '#0d0f11',
                weight: selected ? 3 : adapter ? 2 : 1.5,
                dashArray: adapter && !selected ? '3 3' : undefined,
                fillColor: STATUS_COLOR[status],
                fillOpacity: adapter ? 0.15 : status === 'unknown' ? 0.55 : 0.95,
              }}
              eventHandlers={{ click: () => onSelect(s.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {s.name}
                {adapter ? ' · adapter needed' : ''}
              </Tooltip>
            </CircleMarker>
          )
        })}

      {nav && <HeadingMarker pos={nav.pos} heading={nav.heading} />}

      {!nav && userLoc && (
        <>
          <CircleMarker center={userLoc} radius={14} pathOptions={{ stroke: false, fillColor: '#4f9dff', fillOpacity: 0.2 }} interactive={false} />
          <CircleMarker center={userLoc} radius={6} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#4f9dff', fillOpacity: 1 }} interactive={false} />
        </>
      )}
    </MapContainer>
  )
}

function rank(s: StationStatus) {
  return s === 'unknown' ? 0 : 1
}

/** Pans the map when the parent asks (e.g. after picking a search result). */
function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [target, map])
  return null
}

/**
 * Navigation camera: zoomed in on you, placed in the lower third of the screen
 * so more of the road ahead is visible. Dragging the map pauses following
 * (the parent shows a Re-center button).
 */
function FollowCam({ frame, following, onUserPan }: { frame: NavFrame | null; following: boolean; onUserPan: () => void }) {
  const map = useMap()
  const programmatic = useRef(false)
  useMapEvents({
    dragstart: () => {
      if (frame && !programmatic.current) onUserPan()
    },
  })
  useEffect(() => {
    if (!frame || !following) return
    const zoom = Math.max(map.getZoom(), 17)
    const size = map.getSize()
    const pt = map.project(frame.pos, zoom).subtract([0, size.y * 0.22])
    programmatic.current = true
    map.setView(map.unproject(pt, zoom), zoom, { animate: true, duration: 0.8 })
    const t = setTimeout(() => (programmatic.current = false), 900)
    return () => clearTimeout(t)
  }, [frame, following, map])
  return null
}

/** Blue arrow pointing the way you're driving (dot until a heading is known). */
function HeadingMarker({ pos, heading }: { pos: LatLng; heading: number | null }) {
  const h = heading == null ? null : Math.round(heading / 5) * 5
  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        html:
          h == null
            ? '<div style="width:44px;height:44px;display:grid;place-items:center"><div style="width:18px;height:18px;border-radius:50%;background:#4f9dff;border:3px solid #fff;box-shadow:0 0 0 8px rgba(79,157,255,.25)"></div></div>'
            : `<svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(${h}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))"><circle cx="22" cy="22" r="20" fill="rgba(79,157,255,.22)"/><path d="M22 6 L34 34 L22 28 L10 34 Z" fill="#4f9dff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
      }),
    [h],
  )
  return <Marker position={pos} icon={icon} interactive={false} zIndexOffset={1000} />
}

/** Zooms out to show the whole route, leaving room for the bottom sheet. */
function FitRoute({ route }: { route: LatLng[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!route || route.length < 2) return
    const mobile = window.innerWidth < 768
    // On phones the bottom sheet (46dvh in "peek") covers the lower map, so
    // reserve that much space or the route's start hides under it.
    const sheet = mobile ? Math.round(window.innerHeight * 0.46) : 0
    map.flyToBounds(route, {
      paddingTopLeft: [40, mobile ? 150 : 120],
      paddingBottomRight: [40, sheet + 30],
      duration: 0.7,
    })
  }, [route, map])
  return null
}

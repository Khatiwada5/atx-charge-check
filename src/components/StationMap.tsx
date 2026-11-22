/**
 * StationMap — the Leaflet map of Austin with one pin per charging station.
 *
 * Pin color = the station's current crowd-reported status (green working,
 * amber busy, red broken, gray no recent reports). Fast (DC) chargers get a
 * larger pin. Clicking a pin selects the station; the parent page owns the
 * selection and shows the detail panel.
 *
 * Tiles: CARTO's dark basemap over OpenStreetMap data (free, attribution
 * required and shown bottom-right).
 */

import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Station } from '../lib/stations'
import type { StationStatus } from '../lib/station-status'

// Hex, not CSS vars: pins draw on a <canvas> (preferCanvas, fast with 500+
// markers) and canvas can't resolve var(). Keep in sync with themes.css.
export const STATUS_COLOR: Record<StationStatus, string> = {
  working: '#34d399',
  busy: '#f2b134',
  broken: '#ef5350',
  unknown: '#6b7280',
}

const AUSTIN: [number, number] = [30.2747, -97.7404]

type Props = {
  stations: Station[]
  statusOf: (id: string) => StationStatus
  selectedId: string | null
  onSelect: (id: string) => void
  flyTo: [number, number] | null
}

export default function StationMap({ stations, statusOf, selectedId, onSelect, flyTo }: Props) {
  return (
    <MapContainer
      center={AUSTIN}
      zoom={12}
      minZoom={10}
      preferCanvas
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={19}
      />
      <FlyTo target={flyTo} />
      {/* Unknown pins first so reported stations draw on top of them. */}
      {[...stations]
        .sort((a, b) => rank(statusOf(a.id)) - rank(statusOf(b.id)))
        .map((s) => {
          const status = statusOf(s.id)
          const selected = s.id === selectedId
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lng]}
              radius={selected ? 11 : s.fast ? 7 : 5}
              pathOptions={{
                color: selected ? '#ffffff' : '#0d0f11',
                weight: selected ? 3 : 1.5,
                fillColor: STATUS_COLOR[status],
                fillOpacity: status === 'unknown' ? 0.55 : 0.95,
              }}
              eventHandlers={{ click: () => onSelect(s.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {s.name}
              </Tooltip>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}

function rank(s: StationStatus) {
  return s === 'unknown' ? 0 : 1
}

/** Pans the map when the parent asks (e.g. after picking a search result). */
function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [target, map])
  return null
}

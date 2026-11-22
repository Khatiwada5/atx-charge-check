/**
 * StationMap — the map, on MapLibre GL (WebGL), so it can rotate, tilt into
 * a 3D driving view, and animate the camera smoothly like Google / Apple Maps.
 *
 * Layers (bottom → top):
 *   OpenFreeMap dark vector basemap (roads, water, street names)
 *   3D buildings (extruded from OSM building heights; visible when tilted)
 *   route line (casing + blue), drawn under the street names
 *   station pins — ONE GeoJSON circle layer for all ~500 stations, colored by
 *     crowd status; stations your car can only use with an adapter are
 *     hollow; fast chargers are bigger
 *   you: blue dot (browsing) or a flat arrow "puck" (navigating)
 *
 * Camera:
 *   browsing  — flyTo a picked station, fitBounds for a route preview
 *   Start     — cinematic intro: fly in to street level, tilt to 60°, turn
 *               the map so your direction of travel is up
 *   driving   — ease along with each GPS fix; heading-up or north-up
 *   panning   — any drag/rotate/zoom by the user pauses following (parent
 *               shows Re-center)
 *   End       — ease back to a flat, north-up view
 *
 * For tests, the container mirrors the camera in data-zoom / data-bearing /
 * data-pitch attributes.
 */

import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, Point } from 'geojson'
import type { Station } from '../lib/stations'
import type { StationStatus } from '../lib/station-status'
import type { LatLng } from '../lib/geo'
import type { NavFrame } from './NavigationView'
import type { Jam } from '../lib/traffic'

export const STATUS_COLOR: Record<StationStatus, string> = {
  working: '#34d399',
  busy: '#f2b134',
  broken: '#ef5350',
  unknown: '#6b7280',
}

const AUSTIN: [number, number] = [-97.7404, 30.2747] // [lng, lat] — MapLibre order
const ll = (p: LatLng): [number, number] => [p[1], p[0]]

/**
 * Basemap: OpenFreeMap's dark vector style (OpenStreetMap data, free, no
 * key). Vector tiles stay sharp at street-level zoom and keep street names
 * upright while the map rotates — raster tiles can do neither.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

/** Where the car sits on screen while driving: low, so the road ahead shows. */
function navPadding(map: MLMap) {
  const h = map.getContainer().clientHeight
  return { top: Math.round(h * 0.32), bottom: 120, left: 0, right: 0 }
}

type Props = {
  stations: Station[]
  statusOf: (id: string) => StationStatus
  needsAdapter: (id: string) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  flyTo: LatLng | null
  userLoc: LatLng | null
  route: LatLng[] | null
  /** Live-traffic slowdowns to paint over the route (orange slow, red heavy, dark red closed). */
  jams: Jam[] | null
  /** Turn-by-turn mode: follow this position, draw what's left of the route. */
  nav: NavFrame | null
  following: boolean
  headingUp: boolean
  onUserPan: () => void
}

export default function StationMap(props: Props) {
  const { stations, statusOf, needsAdapter, selectedId, flyTo, userLoc, route, jams, nav, following, headingUp } = props
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const ready = useRef(false)
  const cb = useRef(props)
  cb.current = props
  const meMarker = useRef<maplibregl.Marker | null>(null)
  const puck = useRef<maplibregl.Marker | null>(null)
  const introUntil = useRef(0)
  const wasNav = useRef(false)

  // ── Create the map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!box.current) return
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE_URL,
      center: AUSTIN,
      zoom: 12,
      minZoom: 9,
      maxPitch: 65,
      attributionControl: { compact: true, customAttribution: 'Stations © OpenStreetMap · Routes: OSRM' },
      dragRotate: true,
      pitchWithRotate: true,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')

    const mirror = () => {
      const el = map.getContainer()
      el.dataset.zoom = map.getZoom().toFixed(2)
      el.dataset.bearing = map.getBearing().toFixed(1)
      el.dataset.pitch = map.getPitch().toFixed(1)
    }
    map.on('move', mirror)
    map.on('rotate', () => {
      if (cb.current.nav && cb.current.headingUp) puck.current?.setRotation(map.getBearing())
    })

    // A drag / rotate / pinch by the user (originalEvent set) pauses following.
    for (const ev of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'] as const) {
      map.on(ev, (e: { originalEvent?: Event }) => {
        if (e.originalEvent && cb.current.nav) cb.current.onUserPan()
      })
    }

    map.on('load', () => {
      // Draw our layers under the street-name labels, like the maps apps.
      const labelsFirst = map.getStyle().layers.find((l) => l.type === 'symbol')?.id

      map.addLayer(
        {
          id: '3d-buildings',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 15,
          paint: {
            'fill-extrusion-color': '#24282e',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.85],
          },
        },
        labelsFirst,
      )

      map.addSource('route', { type: 'geojson', data: emptyLine() })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#08213b', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11, 18, 24] },
      }, labelsFirst)
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#5aaeff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 18, 16] },
      }, labelsFirst)

      map.addSource('traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer(
        {
          id: 'traffic',
          type: 'line',
          source: 'traffic',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'level'], 'closed', '#8b1a1a', 'heavy', '#ef4444', '#f59e0b'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 18, 16],
          },
        },
        labelsFirst,
      )

      map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        layout: { 'circle-sort-key': ['get', 'sort'] },
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['*', ['get', 'r'], 0.7], 16, ['*', ['get', 'r'], 1.6]],
          'circle-opacity': ['get', 'fill'],
          'circle-stroke-color': ['get', 'stroke'],
          'circle-stroke-width': ['get', 'sw'],
          'circle-pitch-alignment': 'map',
        },
      })

      map.on('click', 'stations', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (id) cb.current.onSelect(String(id))
      })
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'station-tip' })
      map.on('mouseenter', 'stations', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (!f || matchMedia('(hover: none)').matches) return
        const p = f.properties as { name: string; adapter: boolean }
        popup
          .setLngLat((f.geometry as Point).coordinates as [number, number])
          .setText(p.name + (p.adapter ? ' · adapter needed' : ''))
          .addTo(map)
      })
      map.on('mouseleave', 'stations', () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })

      // Start the compact attribution collapsed (the ⓘ button opens it).
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')

      ready.current = true
      map.fire('appready')
    })

    return () => {
      ready.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  /** Run `fn` now if the style is loaded, else as soon as it is. */
  function whenReady(fn: (m: MLMap) => void) {
    const m = mapRef.current
    if (!m) return
    if (ready.current) fn(m)
    else m.once('appready', () => fn(m))
  }

  // ── Station pins ───────────────────────────────────────────────────────
  useEffect(() => {
    whenReady((m) => {
      const features = stations.map((s) => {
        const status = statusOf(s.id)
        const adapter = needsAdapter(s.id)
        const selected = s.id === selectedId
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
          properties: {
            id: s.id,
            name: s.name,
            adapter,
            color: STATUS_COLOR[status],
            r: selected ? 10 : s.fast ? 6.5 : 4.5,
            fill: adapter ? 0.15 : status === 'unknown' ? 0.6 : 0.95,
            stroke: selected ? '#ffffff' : adapter ? STATUS_COLOR[status] : '#0d0f11',
            sw: selected ? 3 : adapter ? 2 : 1.5,
            sort: selected ? 3 : status === 'unknown' ? 0 : 1,
          },
        }
      })
      ;(m.getSource('stations') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    })
  }, [stations, statusOf, needsAdapter, selectedId])

  // ── Route line (preview, or what's left while driving) ─────────────────
  const line = nav ? nav.path : route
  useEffect(() => {
    whenReady((m) => {
      ;(m.getSource('route') as GeoJSONSource).setData(
        line && line.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.map(ll) } } : emptyLine(),
      )
    })
  }, [line])

  // ── Traffic slowdowns ──────────────────────────────────────────────────
  useEffect(() => {
    whenReady((m) => {
      ;(m.getSource('traffic') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: (jams ?? [])
          .filter((j) => j.coords.length > 1)
          .map((j) => ({ type: 'Feature' as const, properties: { level: j.level }, geometry: { type: 'LineString' as const, coordinates: j.coords.map(ll) } })),
      })
    })
  }, [jams])

  // ── Browsing camera ────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || nav) return
    whenReady((m) => m.flyTo({ center: ll(flyTo), zoom: Math.max(m.getZoom(), 15), duration: 700, essential: true }))
  }, [flyTo])  

  useEffect(() => {
    if (!route || route.length < 2 || nav) return
    whenReady((m) => {
      const b = new maplibregl.LngLatBounds()
      route.forEach((p) => b.extend(ll(p)))
      const mobile = window.innerWidth < 768
      m.fitBounds(b, {
        padding: { top: mobile ? 150 : 120, bottom: mobile ? Math.round(window.innerHeight * 0.46) + 30 : 40, left: 40, right: 40 },
        bearing: 0,
        pitch: 0,
        duration: 800,
      })
    })
  }, [route])  

  // ── You (browsing): blue dot ───────────────────────────────────────────
  useEffect(() => {
    whenReady((m) => {
      if (!userLoc || nav) {
        meMarker.current?.remove()
        meMarker.current = null
        return
      }
      if (!meMarker.current) meMarker.current = new maplibregl.Marker({ element: dotEl() })
      meMarker.current.setLngLat(ll(userLoc)).addTo(m)
    })
  }, [userLoc, nav])

  // ── Driving camera + puck ──────────────────────────────────────────────
  useEffect(() => {
    whenReady((m) => {
      if (!nav) {
        puck.current?.remove()
        puck.current = null
        if (wasNav.current) {
          wasNav.current = false
          m.easeTo({ pitch: 0, bearing: 0, zoom: 15, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 900 })
        }
        return
      }
      if (!puck.current) {
        puck.current = new maplibregl.Marker({ element: puckEl(), rotationAlignment: 'map', pitchAlignment: 'map' })
      }
      // Heading-up: like Google Maps, the arrow stays pointing up and the map
      // turns underneath it (kept in sync on every 'rotate' below). North-up:
      // the arrow turns to your heading.
      puck.current.setLngLat(ll(nav.pos)).setRotation(headingUp ? m.getBearing() : (nav.heading ?? 0)).addTo(m)

      const bearing = headingUp ? (nav.heading ?? m.getBearing()) : 0
      if (!wasNav.current) {
        // Cinematic start: swoop down to street level, tilt, turn heading-up.
        wasNav.current = true
        introUntil.current = Date.now() + 2300
        m.flyTo({ center: ll(nav.pos), zoom: 17.3, pitch: 60, bearing, padding: navPadding(m), duration: 2200, curve: 1.6, essential: true })
        // The car kept moving during the fly-in: line up with it right after.
        setTimeout(() => {
          const n = cb.current.nav
          if (!n || !cb.current.following) return
          m.easeTo({
            center: ll(n.pos),
            bearing: cb.current.headingUp ? (n.heading ?? m.getBearing()) : 0,
            padding: navPadding(m),
            duration: 600,
          })
        }, 2300)
        return
      }
      if (!following || Date.now() < introUntil.current) return
      m.easeTo({ center: ll(nav.pos), bearing, pitch: m.getPitch() < 20 ? 60 : m.getPitch(), padding: navPadding(m), duration: 950, easing: (t) => t })
    })
  }, [nav, following, headingUp])

  // Re-center: snap back into the driving camera right away.
  useEffect(() => {
    if (!following || !nav) return
    whenReady((m) =>
      m.easeTo({
        center: ll(nav.pos),
        zoom: Math.max(m.getZoom(), 17),
        pitch: 60,
        bearing: headingUp ? (nav.heading ?? 0) : 0,
        padding: navPadding(m),
        duration: 700,
      }),
    )
  }, [following, headingUp])  

  return <div ref={box} className="h-full w-full" data-testid="map" />
}

function emptyLine(): Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
}

function dotEl() {
  const el = document.createElement('div')
  el.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#4f9dff;border:3px solid #fff;box-shadow:0 0 0 8px rgba(79,157,255,.25)'
  return el
}

/** Flat navigation arrow; MapLibre rotates/tilts it with the road. */
function puckEl() {
  const el = document.createElement('div')
  el.dataset.testid = 'nav-puck'
  el.innerHTML =
    '<svg width="54" height="54" viewBox="0 0 54 54" style="filter:drop-shadow(0 3px 5px rgba(0,0,0,.55))">' +
    '<circle cx="27" cy="27" r="25" fill="rgba(79,157,255,.20)"/>' +
    '<path d="M27 7 L41 42 L27 34 L13 42 Z" fill="#4f9dff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>'
  return el
}

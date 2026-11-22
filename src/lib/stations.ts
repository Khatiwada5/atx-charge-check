/**
 * The station catalog — 519 public EV charging locations in the Austin area,
 * extracted once from OpenStreetMap (amenity=charging_station; much of it is
 * imported from the US DOE AFDC dataset). It is static: the chargers don't
 * move, only their status changes, and status lives in the `reports`
 * collection.
 *
 * Fields: id (OSM element id), name, lat/lng, network, fast (has a DC fast
 * connector: CCS / CHAdeMO / Tesla), ports (capacity, 0 if unknown).
 */

import raw from '../data/stations.json'

export type Station = {
  id: string
  name: string
  lat: number
  lng: number
  network: string
  fast: boolean
  ports: number
}

export const STATIONS: Station[] = raw as Station[]

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]))

/**
 * Plugs, cars, and "can my car charge here?"
 *
 * North American public chargers use five plug types:
 *   j1772    — Level 2 AC, the standard on almost every non-Tesla charger
 *   ccs1     — DC fast (CCS Combo 1): most non-Tesla EVs
 *   chademo  — DC fast, older; mainly the Nissan Leaf
 *   nacs_dc  — Tesla Supercharger (NACS / SAE J3400 plug, DC fast)
 *   nacs_ac  — Tesla Destination / Wall Connector (NACS plug, Level 2 AC)
 *
 * A car has a charge PORT. Each port fits some plugs directly and others with
 * a common adapter. We deliberately model ports, not car brands, because the
 * port is what decides compatibility; the VEHICLES list just maps popular
 * models to their port. Model years matter (several makers switched from
 * CCS1 to NACS around 2025), so ambiguous models carry a year range.
 *
 * Supercharger access for non-Teslas also depends on the car maker's deal with
 * Tesla, so "with adapter" at a Supercharger is shown with that caveat.
 */

import type { Station } from './stations'

export type Plug = 'j1772' | 'ccs1' | 'chademo' | 'nacs_dc' | 'nacs_ac'
export type Port = 'nacs' | 'ccs1' | 'chademo'
export type Compat = 'direct' | 'adapter' | 'none' | 'unknown'

export const PLUG_LABEL: Record<Plug, string> = {
  j1772: 'J1772 (Level 2)',
  ccs1: 'CCS1 (DC fast)',
  chademo: 'CHAdeMO (DC fast)',
  nacs_dc: 'Tesla Supercharger (DC fast)',
  nacs_ac: 'Tesla Destination (Level 2)',
}

export const PLUG_SHORT: Record<Plug, string> = {
  j1772: 'J1772',
  ccs1: 'CCS1',
  chademo: 'CHAdeMO',
  nacs_dc: 'Supercharger',
  nacs_ac: 'Tesla L2',
}

export const DC_PLUGS: Plug[] = ['ccs1', 'chademo', 'nacs_dc']

/** What each port takes directly, and what it takes with an adapter (+ why). */
const PORT_RULES: Record<Port, { direct: Plug[]; adapter: Partial<Record<Plug, string>> }> = {
  nacs: {
    direct: ['nacs_dc', 'nacs_ac'],
    adapter: {
      j1772: 'J1772→NACS adapter (Teslas ship with one)',
      ccs1: 'CCS1→NACS adapter',
    },
  },
  ccs1: {
    direct: ['j1772', 'ccs1'],
    adapter: {
      nacs_dc: 'NACS→CCS1 adapter, and only if your car maker has Supercharger access',
      nacs_ac: 'NACS→J1772 adapter',
    },
  },
  chademo: {
    direct: ['j1772', 'chademo'],
    adapter: { nacs_ac: 'NACS→J1772 adapter' },
  },
}

export type Vehicle = { id: string; label: string; port: Port; group: string }

export const PORT_LABEL: Record<Port, string> = {
  nacs: 'Tesla / NACS port',
  ccs1: 'CCS1 port',
  chademo: 'CHAdeMO port',
}

export const VEHICLES: Vehicle[] = [
  { id: 'any-nacs', label: 'Any car with a Tesla (NACS) port', port: 'nacs', group: 'By charge port' },
  { id: 'any-ccs1', label: 'Any car with a CCS1 port', port: 'ccs1', group: 'By charge port' },
  { id: 'any-chademo', label: 'Any car with a CHAdeMO port', port: 'chademo', group: 'By charge port' },

  { id: 'tesla-3', label: 'Tesla Model 3', port: 'nacs', group: 'Tesla' },
  { id: 'tesla-y', label: 'Tesla Model Y', port: 'nacs', group: 'Tesla' },
  { id: 'tesla-s', label: 'Tesla Model S', port: 'nacs', group: 'Tesla' },
  { id: 'tesla-x', label: 'Tesla Model X', port: 'nacs', group: 'Tesla' },
  { id: 'tesla-ct', label: 'Tesla Cybertruck', port: 'nacs', group: 'Tesla' },

  { id: 'porsche-taycan', label: 'Porsche Taycan', port: 'ccs1', group: 'Porsche' },
  { id: 'porsche-macan', label: 'Porsche Macan Electric', port: 'ccs1', group: 'Porsche' },

  { id: 'ford-mache', label: 'Ford Mustang Mach-E', port: 'ccs1', group: 'Ford' },
  { id: 'ford-lightning', label: 'Ford F-150 Lightning', port: 'ccs1', group: 'Ford' },

  { id: 'chevy-bolt', label: 'Chevrolet Bolt EV / EUV (2017–23)', port: 'ccs1', group: 'GM' },
  { id: 'chevy-equinox', label: 'Chevrolet Equinox EV (2024–25)', port: 'ccs1', group: 'GM' },
  { id: 'chevy-blazer', label: 'Chevrolet Blazer EV (2024–25)', port: 'ccs1', group: 'GM' },
  { id: 'chevy-silverado', label: 'Chevrolet Silverado EV (2024–25)', port: 'ccs1', group: 'GM' },
  { id: 'cadillac-lyriq', label: 'Cadillac Lyriq (2023–25)', port: 'ccs1', group: 'GM' },
  { id: 'gmc-hummer', label: 'GMC Hummer EV (2022–25)', port: 'ccs1', group: 'GM' },

  { id: 'hyundai-ioniq5-old', label: 'Hyundai Ioniq 5 (2022–24)', port: 'ccs1', group: 'Hyundai / Kia' },
  { id: 'hyundai-ioniq5-new', label: 'Hyundai Ioniq 5 (2025+)', port: 'nacs', group: 'Hyundai / Kia' },
  { id: 'hyundai-ioniq6', label: 'Hyundai Ioniq 6 (2023–25)', port: 'ccs1', group: 'Hyundai / Kia' },
  { id: 'kia-ev6', label: 'Kia EV6 (2022–24)', port: 'ccs1', group: 'Hyundai / Kia' },
  { id: 'kia-ev9', label: 'Kia EV9 (2024)', port: 'ccs1', group: 'Hyundai / Kia' },

  { id: 'rivian-r1', label: 'Rivian R1T / R1S (2022–25)', port: 'ccs1', group: 'Rivian / Lucid' },
  { id: 'lucid-air', label: 'Lucid Air', port: 'ccs1', group: 'Rivian / Lucid' },

  { id: 'vw-id4', label: 'Volkswagen ID.4', port: 'ccs1', group: 'Volkswagen / Audi' },
  { id: 'audi-etrongt', label: 'Audi e-tron GT', port: 'ccs1', group: 'Volkswagen / Audi' },
  { id: 'audi-q4', label: 'Audi Q4 e-tron', port: 'ccs1', group: 'Volkswagen / Audi' },

  { id: 'bmw-i4', label: 'BMW i4', port: 'ccs1', group: 'BMW / Mercedes' },
  { id: 'bmw-ix', label: 'BMW iX', port: 'ccs1', group: 'BMW / Mercedes' },
  { id: 'mb-eqe', label: 'Mercedes-Benz EQE', port: 'ccs1', group: 'BMW / Mercedes' },
  { id: 'mb-eqs', label: 'Mercedes-Benz EQS', port: 'ccs1', group: 'BMW / Mercedes' },

  { id: 'nissan-leaf', label: 'Nissan Leaf (2011–25)', port: 'chademo', group: 'Nissan / Toyota / Honda' },
  { id: 'nissan-ariya', label: 'Nissan Ariya', port: 'ccs1', group: 'Nissan / Toyota / Honda' },
  { id: 'toyota-bz4x', label: 'Toyota bZ4X (2023–25)', port: 'ccs1', group: 'Nissan / Toyota / Honda' },
  { id: 'honda-prologue', label: 'Honda Prologue (2024–25)', port: 'ccs1', group: 'Nissan / Toyota / Honda' },

  { id: 'polestar-2', label: 'Polestar 2', port: 'ccs1', group: 'Volvo / Polestar' },
  { id: 'volvo-ex30', label: 'Volvo EX30', port: 'ccs1', group: 'Volvo / Polestar' },
  { id: 'volvo-xc40', label: 'Volvo XC40 / EX40 Recharge', port: 'ccs1', group: 'Volvo / Polestar' },
]

export const VEHICLE_BY_ID = new Map(VEHICLES.map((v) => [v.id, v]))

export function stationPlugs(s: Station): Plug[] {
  return (Object.keys(s.plugs ?? {}) as Plug[]).filter((p) => (s.plugs?.[p] ?? 0) > 0)
}

/** Best way this port can use this station. */
export function compat(s: Station, port: Port): Compat {
  const plugs = stationPlugs(s)
  if (plugs.length === 0) return 'unknown'
  const rule = PORT_RULES[port]
  if (plugs.some((p) => rule.direct.includes(p))) return 'direct'
  if (plugs.some((p) => p in rule.adapter)) return 'adapter'
  return 'none'
}

/** Per-plug breakdown for the station panel. */
export function plugFit(plug: Plug, port: Port): { fit: 'direct' | 'adapter' | 'none'; note?: string } {
  const rule = PORT_RULES[port]
  if (rule.direct.includes(plug)) return { fit: 'direct' }
  const note = rule.adapter[plug]
  return note ? { fit: 'adapter', note } : { fit: 'none' }
}

/** Fast-charge capable for this port (direct or adapter), for the "DC fast" filter. */
export function hasFastFor(s: Station, port: Port | null): boolean {
  const dc = stationPlugs(s).filter((p) => DC_PLUGS.includes(p))
  if (!port) return dc.length > 0
  return dc.some((p) => plugFit(p, port).fit !== 'none')
}

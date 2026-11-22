# ATX Charge Check

**Live:** https://atx-charge-check.app.space

A real-time, crowd-sourced status map for 500+ public EV chargers around Austin, TX. Drivers report a station as **working**, **busy**, or **broken**. Other drivers **confirm** or **dispute** each report, and reports **expire after 3 hours**, so the map shows what's true right now.

Anyone can view the map without an account. Sign in with Google or GitHub to post a report or vote.

- **Filter by your car:** pick your car (Porsche Taycan, Tesla Model Y, Ioniq 5, Nissan Leaf, …) or just your charge port, and the map shows only chargers it can use. Stations that need an adapter get a dashed pin and name the adapter.
- **Turn-by-turn navigation:** *Start* turns the map into a driving view. It zooms in and follows your GPS with a heading arrow, shows the next turn and the distance to it, speaks the directions, shows arrival time and time left, reroutes if you leave the route, keeps the screen on, and offers to report the charger when you arrive. *Preview* only draws the route. *Google Maps* and *Apple Maps* hand off to the phone's own navigation app.
- **Try it from a desk:** add `?sim=10` to the map URL, open a station, and press *Start* to watch a simulated drive at 10× speed.
- **Phone-first:** full-screen map with a swipeable bottom sheet, a *Near you* list sorted by distance, and large tap targets.

## How it works

- **Live sync:** reports and votes travel over a WebSocket. A report posted on one phone appears on every open map within a second.
- **Trust:** each report scores `1 + confirms − disputes`. A report with a score of 0 or less is marked *Disputed* and no longer sets the pin's color. The pin shows the newest report that isn't disputed.
- **One vote each:** the server stamps every vote with the voter's verified ID and refuses a second vote on the same report. You can switch your vote, but you can't vote on your own report.
- **Expiry:** age is measured from the server's timestamp, so the 3-hour limit can't be faked. The map hides expired reports right away, and a cleanup job runs every 15 minutes to delete them and their votes.

## Stack

- [DeepSpace](https://docs.deep.space): auth, permission-checked realtime records, scheduled jobs, and hosting on Cloudflare Workers
- React 19, Vite, Tailwind CSS
- Leaflet, with Esri's dark-gray basemap
- Station and plug data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (`amenity=charging_station`); some fast-charging networks are missing there
- Routes and turn-by-turn steps from the public [OSRM](https://project-osrm.org/) demo router

## Project map

| Path | What it does |
| --- | --- |
| `src/schemas/reports-schema.ts` | The `reports` table, its permissions, and the expiry window |
| `src/schemas/votes-schema.ts` | The `votes` table, limited to one vote per user per report |
| `src/lib/station-status.ts` | Pure logic for expiry, vote scoring, and each station's status |
| `src/cron.ts` | Cleanup job that deletes expired reports and their votes |
| `src/components/StationMap.tsx` | The Leaflet map with status-colored pins |
| `src/components/StationPanel.tsx` | Station details, directions, plug fit, the report buttons, and the vote buttons |
| `src/components/VehiclePicker.tsx` | The searchable "What do you drive?" picker |
| `src/lib/plugs.ts` | Plug types, car → charge port list, and the direct/adapter/no-fit rules |
| `src/lib/geo.ts` | Distances, Google/Apple Maps links, and routes with turn-by-turn steps (OSRM) |
| `src/lib/nav.ts` | Navigation math: snapping GPS to the route, the next turn, time left, off-route detection, and instruction text |
| `src/components/NavigationView.tsx` | Driving mode: turn banner, ETA bar, voice, rerouting, screen wake lock, and the simulator |
| `src/pages/(app)/map.tsx` | The `/map` page: live queries, search, and filters |
| `src/data/stations.json` | The station catalog from OpenStreetMap |
| `tests/reports.spec.ts` | Two-driver end-to-end test: report, live sync, confirm, dispute |
| `tests/vehicle-and-directions.spec.ts` | Phone-sized test: car filter, adapter warning, map hand-offs, route, near you |
| `tests/navigation.spec.ts` | Simulated GPS drive: start, follow, reroute, arrive, report |

## Run it locally

Requires Node 22.15+, 24, or 26, and npm 11.6+.

```bash
npm install
npx deepspace auth login
npx deepspace dev start      # http://localhost:5173
npx deepspace test run all   # unit and Playwright tests
```

Deploys go through DeepSpace (`npx deepspace deploy`). This GitHub repository is a public copy of the source.

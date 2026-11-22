# ATX Charge Check

**Live:** https://atx-charge-check.app.space

A real-time, crowd-sourced status map for 500+ public EV chargers around Austin, TX. Drivers report a station as **working**, **busy**, or **broken**. Other drivers **confirm** or **dispute** each report, and reports **expire after 3 hours**, so the map shows what's true right now.

Anyone can view the map without an account. Sign in with Google or GitHub to post a report or vote.

## How it works

- **Live sync:** reports and votes travel over a WebSocket. A report posted on one phone appears on every open map within a second.
- **Trust:** each report scores `1 + confirms − disputes`. A report with a score of 0 or less is marked *Disputed* and no longer sets the pin's color. The pin shows the newest report that isn't disputed.
- **One vote each:** the server stamps every vote with the voter's verified ID and refuses a second vote on the same report. You can switch your vote, but you can't vote on your own report.
- **Expiry:** age is measured from the server's timestamp, so the 3-hour limit can't be faked. The map hides expired reports right away, and a cleanup job runs every 15 minutes to delete them and their votes.

## Stack

- [DeepSpace](https://docs.deep.space): auth, permission-checked realtime records, scheduled jobs, and hosting on Cloudflare Workers
- React 19, Vite, Tailwind CSS
- Leaflet, with Esri's dark-gray basemap
- Station data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (`amenity=charging_station`)

## Project map

| Path | What it does |
| --- | --- |
| `src/schemas/reports-schema.ts` | The `reports` table, its permissions, and the expiry window |
| `src/schemas/votes-schema.ts` | The `votes` table, limited to one vote per user per report |
| `src/lib/station-status.ts` | Pure logic for expiry, vote scoring, and each station's status |
| `src/cron.ts` | Cleanup job that deletes expired reports and their votes |
| `src/components/StationMap.tsx` | The Leaflet map with status-colored pins |
| `src/components/StationPanel.tsx` | Station details, the report buttons, and the vote buttons |
| `src/pages/(app)/map.tsx` | The `/map` page: live queries, search, and filters |
| `src/data/stations.json` | The station catalog from OpenStreetMap |
| `tests/reports.spec.ts` | Two-driver end-to-end test: report, live sync, confirm, dispute |

## Run it locally

Requires Node 22.15+, 24, or 26, and npm 11.6+.

```bash
npm install
npx deepspace auth login
npx deepspace dev start      # http://localhost:5173
npx deepspace test run all   # unit and Playwright tests
```

Deploys go through DeepSpace (`npx deepspace deploy`). This GitHub repository is a public copy of the source.

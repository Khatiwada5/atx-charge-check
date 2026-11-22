/**
 * In-app turn-by-turn navigation ("Start"), phone-sized, with faked GPS.
 *
 *   1. Start → banner shows a real maneuver + distance, bottom bar shows ETA,
 *      the map zooms in to street level and follows the car.
 *   2. Driving off the route triggers an automatic reroute.
 *   3. Reaching the charger shows "You've arrived" → Report opens the sheet.
 *   4. The ?sim drive replays the route end-to-end and arrives.
 */
import { test, expect, type Page } from '@playwright/test'

const DOWNTOWN = { latitude: 30.2672, longitude: -97.7431 }
const STATION = 'Austin Motel Tesla Destination' // S Congress, ~2 km away

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: DOWNTOWN,
  permissions: ['geolocation'],
})

async function openStation(page: Page) {
  await page.getByLabel('Search stations').fill('Austin Motel')
  await page.getByRole('button', { name: STATION, exact: true }).click()
  await expect(page.getByTestId('station-panel')).toBeVisible()
}

/** Current map zoom, read from the basemap tile URLs (…/tile/{z}/{y}/{x}). */
async function mapZoom(page: Page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.leaflet-tile-container img.leaflet-tile-loaded')] as HTMLImageElement[]
    const img = imgs[imgs.length - 1]
    const m = img?.src.match(/tile\/(\d+)\//)
    return m ? Number(m[1]) : 0
  })
}

test('Start navigates turn by turn, reroutes, and arrives', async ({ page, context }) => {
  await page.goto('/map')
  await openStation(page)

  await page.getByTestId('nav-start').click()
  const banner = page.getByTestId('nav-banner')
  await expect(page.getByTestId('nav-instruction')).toHaveText(/^(Head|Turn|Continue|Keep|Merge|Take)/, { timeout: 15_000 })
  await expect(page.getByTestId('nav-distance')).toHaveText(/\d+(\.\d)? (ft|mi)/)
  await expect(page.getByTestId('nav-eta')).toHaveText(/\d+ min/)
  await expect(page.getByTestId('sheet')).toBeHidden() // full-screen map while driving
  await expect.poll(() => mapZoom(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(16)

  // Drive ~400 m off the route (twice — one bad fix isn't enough) → reroute.
  const before = await page.getByTestId('nav-instruction').textContent()
  await context.setGeolocation({ latitude: 30.2672, longitude: -97.7475 })
  await page.waitForTimeout(400)
  await context.setGeolocation({ latitude: 30.26725, longitude: -97.74755 })
  await expect(banner.getByText('Rerouting…')).toBeVisible({ timeout: 10_000 })
  await expect(banner.getByText('Rerouting…')).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId('nav-instruction')).not.toHaveText(before ?? '', { timeout: 5_000 })

  // Pull up at the charger (its coordinates from src/data/stations.json).
  await context.setGeolocation({ latitude: 30.2514, longitude: -97.74938 })
  await page.waitForTimeout(300)
  await context.setGeolocation({ latitude: 30.251397, longitude: -97.749385 })
  await expect(banner.getByText("You've arrived")).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('nav-end').click() // labelled "Report" on arrival
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-sheet', 'full')
  await expect(page.getByTestId('report-working')).toBeVisible()
})

test('simulated drive (?sim) plays the whole route to arrival', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/map?sim=50')
  await openStation(page)
  await page.getByTestId('nav-start').click()
  await expect(page.getByTestId('nav-instruction')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('nav-banner').getByText("You've arrived")).toBeVisible({ timeout: 60_000 })
})

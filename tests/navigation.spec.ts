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

/** Camera state mirrored by StationMap onto the map container. */
async function camera(page: Page) {
  const d = await page.getByTestId('map').evaluate((el) => ({ ...(el as HTMLElement).dataset }))
  return { zoom: Number(d.zoom ?? 0), bearing: Number(d.bearing ?? 0), pitch: Number(d.pitch ?? 0) }
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
  // Cinematic start: street level, tilted 3D view.
  await expect.poll(async () => (await camera(page)).zoom, { timeout: 10_000 }).toBeGreaterThanOrEqual(17)
  await expect.poll(async () => (await camera(page)).pitch).toBeGreaterThan(50)

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

test('3D heading-up view, compass toggle, voice modes and lane guidance', async ({ page }) => {
  await page.goto('/map')
  // Downtown → The Domain: the first turn (left onto W 6th St) has mapped lanes.
  await page.getByLabel('Search stations').fill('Domain Tesla')
  await page.getByRole('button', { name: 'The Domain Tesla Supercharger', exact: true }).click()
  await page.getByTestId('nav-start').click()
  await expect(page.getByTestId('nav-instruction')).toBeVisible({ timeout: 15_000 })

  // Heading-up: the map turns so the road ahead is up (bearing ≠ 0 here).
  await expect.poll(async () => Math.abs((await camera(page)).bearing), { timeout: 8_000 }).toBeGreaterThan(5)
  await page.getByTestId('nav-compass').click() // → north up
  await expect.poll(async () => Math.abs((await camera(page)).bearing), { timeout: 5_000 }).toBeLessThan(1)
  await page.getByTestId('nav-compass').click() // → heading up again
  await expect.poll(async () => Math.abs((await camera(page)).bearing), { timeout: 5_000 }).toBeGreaterThan(5)

  // Lane guidance for the left turn: some lanes lit, some not.
  const lanes = page.getByTestId('nav-lanes').locator('[data-valid]')
  await expect(lanes.first()).toBeVisible()
  expect(await page.getByTestId('nav-lanes').locator('[data-valid="true"]').count()).toBeGreaterThan(0)
  expect(await page.getByTestId('nav-lanes').locator('[data-valid="false"]').count()).toBeGreaterThan(0)

  // Voice: All → Alerts only → Off → All, with an on-screen label each time.
  const v = page.getByTestId('nav-voice')
  await expect(v).toHaveAttribute('data-voice', 'all')
  await v.click()
  await expect(v).toHaveAttribute('data-voice', 'alerts')
  await expect(page.getByTestId('voice-toast')).toHaveText('Alerts only')
  await v.click()
  await expect(v).toHaveAttribute('data-voice', 'off')
  await expect(page.getByTestId('voice-toast')).toHaveText('Voice off')
  await v.click()
  await expect(v).toHaveAttribute('data-voice', 'all')

  // End: camera flattens back to a north-up map.
  await page.getByTestId('nav-end').click()
  await expect.poll(async () => (await camera(page)).pitch, { timeout: 5_000 }).toBeLessThan(1)
})

/**
 * Phone-sized spec for the "find a charger for MY car and get there" flow:
 *   - pick a Porsche Taycan → Tesla-only Superchargers show "adapter needed",
 *     CHAdeMO-only stations disappear
 *   - the station sheet shows Google / Apple Maps hand-off links with the
 *     station's coordinates
 *   - "Route" uses (faked) GPS and draws a real driving route with ETA
 *
 * Signed-out on purpose: none of this needs an account.
 */
import { test, expect } from '@playwright/test'

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: 30.2672, longitude: -97.7431 }, // downtown Austin
  permissions: ['geolocation'],
})

async function openStation(page: import('@playwright/test').Page, search: string, name: string) {
  await page.getByLabel('Search stations').fill(search)
  await page.getByRole('button', { name, exact: true }).first().click()
  await expect(page.getByTestId('station-panel')).toBeVisible()
}

test('pick a Taycan, open a Supercharger, see adapter + map hand-offs + route', async ({ page }) => {
  await page.goto('/map')

  // Choose the car.
  await page.getByTestId('my-car').click()
  const picker = page.getByTestId('vehicle-picker')
  await picker.getByLabel('Search vehicles').fill('taycan')
  await picker.getByRole('button', { name: /Porsche Taycan/ }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByTestId('my-car')).toContainText('Porsche Taycan')

  // A Tesla Supercharger: a Taycan needs an adapter there.
  await openStation(page, 'Domain Tesla', 'The Domain Tesla Supercharger')
  await expect(page.getByTestId('fit-badge')).toContainText('needs an adapter')
  await expect(page.getByTestId('plugs')).toContainText('NACS→CCS1 adapter')

  // Hand-off links carry the destination coordinates.
  await expect(page.getByTestId('nav-google')).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=30\.\d+,-97\.\d+.*dir_action=navigate/)
  await expect(page.getByTestId('nav-apple')).toHaveAttribute('href', /maps\.apple\.com\/\?daddr=30\.\d+,-97\.\d+&dirflg=d/)

  // Route preview (without starting navigation) from the faked GPS position.
  await page.getByTestId('directions').getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByTestId('route-summary')).toContainText(/min/, { timeout: 15_000 })
  await expect(page.getByTestId('route-summary')).toContainText(/mi by car/)

  // The sheet is in its "peek" height, so the map stays visible above it.
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-sheet', 'peek')
})

test('a Leaf driver does not see a Tesla-only fast charger as a fit', async ({ page }) => {
  await page.goto('/map')
  await page.getByTestId('my-car').click()
  await page.getByTestId('vehicle-picker').getByLabel('Search vehicles').fill('leaf')
  await page.getByTestId('vehicle-picker').getByRole('button', { name: /Nissan Leaf/ }).click()

  await page.getByLabel('Search stations').fill('Domain Tesla')
  await expect(page.getByRole('button', { name: /The Domain Tesla Supercharger/ })).toContainText("won't fit")
})

test('near-you list sorts chargers by distance from GPS', async ({ page }) => {
  await page.goto('/map')
  await page.getByRole('button', { name: 'Expand panel' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  const items = page.getByTestId('nearby-list').locator('li')
  await expect(items.first()).toBeVisible({ timeout: 10_000 })
  const miles = await items.locator('span.tabular-nums').allTextContents()
  const nums = miles.map((t) => (t.endsWith('ft') ? parseFloat(t) / 5280 : parseFloat(t)))
  expect([...nums].sort((a, b) => a - b)).toEqual(nums)
})

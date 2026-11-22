/**
 * Live-traffic UI. The TomTom answer from our worker is faked here (it's the
 * external, quota-limited boundary), so this runs with or without a key.
 * The real worker route is covered by the "guards" test below.
 */
import { test, expect, type Page } from '@playwright/test'

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: 30.2672, longitude: -97.7431 },
  permissions: ['geolocation'],
})

async function fakeTraffic(page: Page, delayS: number) {
  await page.route('**/api/traffic?*', (route) =>
    route.fulfill({
      json: {
        available: true,
        travelTimeS: 1080 + delayS,
        noTrafficS: 1080,
        delayS,
        lengthM: 18000,
        jams: [{ coords: [[30.27, -97.745], [30.28, -97.75]], level: 'heavy', delayS }],
      },
    }),
  )
}

async function openDomain(page: Page) {
  await page.goto('/map')
  await page.getByLabel('Search stations').fill('Domain Tesla')
  await page.getByRole('button', { name: 'The Domain Tesla Supercharger', exact: true }).click()
}

test('preview and navigation show traffic delay, colored like the maps apps', async ({ page }) => {
  await fakeTraffic(page, 12 * 60)
  await openDomain(page)
  await page.getByTestId('directions').getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByTestId('traffic-note')).toHaveText('+12 min due to traffic', { timeout: 15_000 })

  await page.getByTestId('nav-start').click()
  await expect(page.getByTestId('nav-traffic')).toHaveText('+12 min traffic', { timeout: 15_000 })
  await expect(page.getByTestId('nav-eta')).toHaveAttribute('data-tone', 'heavy')
})

test('without live traffic the app says it is using typical times', async ({ page }) => {
  await page.route('**/api/traffic?*', (route) => route.fulfill({ json: { available: false, reason: 'not_configured' } }))
  await openDomain(page)
  await page.getByTestId('directions').getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByTestId('traffic-note')).toContainText('Typical travel time', { timeout: 15_000 })
})

test('worker guards: rejects coordinates outside Austin', async ({ request }) => {
  const bad = await request.get('/api/traffic?from=40.7,-74.0&to=30.3,-97.7')
  expect(bad.status()).toBe(400)
  const ok = await request.get('/api/traffic?from=30.2672,-97.7431&to=30.4019,-97.7239')
  expect(ok.status()).toBe(200)
  const body = await ok.json()
  expect(typeof body.available).toBe('boolean')
})

/**
 * Station pins must not wait for the street-map tiles: on a slow phone the
 * basemap can take seconds, and without pins nobody can open a station to
 * report it. Here the vector tiles are held back entirely.
 */
import { test, expect } from '@playwright/test'

test('pins show even while basemap tiles are still loading', async ({ page }) => {
  // Hang every basemap tile request (the style JSON itself still loads).
  await page.route(/tiles\.openfreemap\.org\/planet\/.+\.pbf/, () => new Promise(() => {}))
  await page.goto('/map')
  await expect(page.getByTestId('map')).toHaveAttribute('data-pins', /^[1-9]\d*$/, { timeout: 8_000 })
})


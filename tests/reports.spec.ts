/**
 * Two-driver spec for the core loop: report → live sync → vote → dispute.
 *
 *   A reports a station broken  → B's open map shows it within seconds
 *   B can't vote twice, A can't vote on their own report
 *   B (and a 2nd dispute) flips the report to "Disputed" → pin falls back
 *
 * Needs 2 DeepSpace test accounts (`npx deepspace test accounts create …`);
 * skipped otherwise.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 usable test accounts')

// A real station from src/data/stations.json; unique name.
const STATION = 'Austin Motel Tesla Destination'

async function openStation(page: import('@playwright/test').Page) {
  await page.goto('/map')
  await page.getByLabel('Search stations').fill('Austin Motel')
  // .first(): the search dropdown comes before the "Latest reports" list.
  await page.getByRole('button', { name: STATION }).first().click()
  await expect(page.getByTestId('station-panel')).toBeVisible()
}

test('a report syncs live to another driver, who can confirm then dispute it', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([openStation(a.page), openStation(b.page)])

  const note = `e2e ${Date.now()}`
  await a.page.getByPlaceholder(/Optional note/).fill(note)
  await a.page.getByTestId('report-broken').click()

  // A sees their own report; voting on it is disabled.
  const aCard = a.page.getByTestId('report-list').locator('li', { hasText: note })
  await expect(aCard).toBeVisible({ timeout: 15_000 })
  await expect(aCard.getByRole('button', { name: /Confirm/ })).toBeDisabled()

  // B receives it over the realtime socket without reloading.
  const bCard = b.page.getByTestId('report-list').locator('li', { hasText: note })
  await expect(bCard).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByTestId('station-status')).toContainText('Broken')

  // B confirms → count 1, and A sees the count too.
  await bCard.getByRole('button', { name: /Confirm/ }).click()
  await expect(bCard.getByRole('button', { name: /Confirm/ })).toHaveText(/1/, { timeout: 10_000 })
  await expect(aCard.getByRole('button', { name: /Confirm/ })).toHaveText(/1/, { timeout: 10_000 })

  // B switches to dispute: still one vote (confirm 0, dispute 1).
  await bCard.getByRole('button', { name: /Dispute/ }).click()
  await expect(bCard.getByRole('button', { name: /Dispute/ })).toHaveText(/1/, { timeout: 10_000 })
  await expect(bCard.getByRole('button', { name: /Confirm/ })).toHaveText(/0/)

  // Score is 1 - 1 = 0 → disputed; it no longer colors the station.
  await expect(bCard.getByText('Disputed')).toBeVisible()
  await expect(a.page.getByTestId('station-status')).not.toContainText('Broken')

  // A re-reports "working": it replaces A's own broken report.
  await a.page.getByTestId('report-working').click()
  await expect(aCard).toHaveCount(0, { timeout: 10_000 })
  await expect(b.page.getByTestId('station-status')).toContainText('Working', { timeout: 10_000 })

  // A removes their report → gone for B too, station back to "No recent reports".
  await a.page.getByTestId('remove-report').click()
  await expect(b.page.getByTestId('station-status')).toContainText('No recent reports', { timeout: 10_000 })
  await expect(a.page.getByTestId('report-list')).toHaveCount(0)
})

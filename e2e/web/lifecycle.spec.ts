import { expect, test } from '@playwright/test'
import {
  VIEWPORT,
  counter,
  decide,
  dispatch,
  errorsOn,
  findingCard,
  findings,
  goTo,
  hudCard,
  hudChip,
  logRow,
  openApp,
  openTriage,
  postComment,
  screenshot,
  triageBadge,
  watchingBanner
} from './ui'

test.use({ viewport: VIEWPORT })

const BLOCKER = 'Two partial refunds of equal amount share one idempotency key'
const MAJOR = 'No test covers the retry path with a different amount'
const PRODUCT = 'Should a refund retry after 24h still be deduplicated?'
const NIT = 'Unused import `RefundStatus`'
const INTEGRATION = 'Promo re-apply assumes sessionExpiresIn is seconds'
const ORIGINAL_SUMMARY = 'The idempotency key is derived from order id and amount, so two legitimate partial refunds of the same amount collide.'
const EDITED_SUMMARY = 'Two partial refunds of the same amount collide on the idempotency key; the retry path also needs a test. Otherwise solid.'

test('three PRs go through the floor, triage, posting, and the log', async ({ page }) => {
  // Paced so the floor can be photographed while both characters are still reviewing.
  await openApp(page, 400)
  await dispatch(page, 412)
  await dispatch(page, 1203)
  await dispatch(page, 58)

  await goTo(page, 'Floor')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudCard(page, 'slot-2')).toContainText('#1203')
  await expect(counter(page, 'queued')).toHaveText('1 queued')
  await expect(hudChip(page, 'slot-1')).toHaveText('Reviewing')
  await expect(hudChip(page, 'slot-2')).toHaveText('Reviewing')
  await screenshot(page, 'floor-busy')
  await expect(hudChip(page, 'slot-2')).toHaveText('Reviewing')

  await expect(triageBadge(page)).toHaveText('2', { timeout: 20_000 })
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you')
  await expect(hudChip(page, 'slot-2')).toHaveText('Needs you')
  await expect(counter(page, 'needs you')).toHaveText('2 needs you')
  // Findings waiting for triage still occupy the desk, so the third PR stays on the shelf.
  await expect(counter(page, 'queued')).toHaveText('1 queued')

  await openTriage(page, 412)
  await expect(page.getByText('2 waiting')).toBeVisible()
  await expect(findings(page)).toHaveCount(4)
  await expect(page.getByText('Request changes', { exact: true })).toBeVisible()
  await decide(page, BLOCKER, 'Approve')
  await decide(page, MAJOR, 'Approve')
  await decide(page, PRODUCT, 'Drop')
  const reason = findingCard(page, PRODUCT).getByLabel('Dropped because')
  await expect(reason).toHaveValue('')
  await reason.selectOption({ label: 'Product decision' })
  await expect(reason).toHaveValue('product_decision')
  await expect(page.getByText('2 approved', { exact: true })).toBeVisible()
  await expect(page.getByText('1 dropped', { exact: true })).toBeVisible()
  await expect(page.getByText('1 pending', { exact: true })).toBeVisible()

  // The summary heads the posted comment, so it can be rewritten after dropping a finding it still asserts.
  const summary = page.getByRole('textbox', { name: 'Summary' })
  await expect(summary).toHaveValue(new RegExp(`^${ORIGINAL_SUMMARY}`))
  await expect(page.getByText('edited', { exact: true })).toHaveCount(0)
  await summary.fill(EDITED_SUMMARY)
  await summary.press('Tab')
  await expect(page.getByText('edited', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore original' })).toBeVisible()
  await expect(summary).toHaveValue(EDITED_SUMMARY)
  await screenshot(page, 'triage')

  await page.getByRole('button', { name: 'Preview comment' }).click()
  const preview = page.locator('div.rounded-lg').filter({ has: page.getByText('Comment preview', { exact: true }) })
  await expect(preview).toContainText('Review of a1b2c3d')
  await expect(preview).toContainText(EDITED_SUMMARY)
  await expect(preview).not.toContainText(ORIGINAL_SUMMARY)
  await expect(preview).toContainText('2 findings')
  await expect(preview).toContainText(BLOCKER)
  await expect(preview).toContainText(MAJOR)
  await expect(preview).not.toContainText(PRODUCT)
  await expect(preview).not.toContainText('Unused import')
  await screenshot(page, 'triage-preview')

  await postComment(page)
  await expect(page.getByRole('status').filter({ hasText: 'Posted to #412' })).toBeVisible()
  await expect(watchingBanner(page)).toBeVisible()
  await expect(page.getByText('Posted comment')).toBeVisible()
  await expect(page.getByText(EDITED_SUMMARY)).toBeVisible()
  await expect(page.getByRole('button', { name: 'View on GitHub' })).toBeVisible()
  await expect(page.getByText(NIT)).toHaveCount(0)

  // #1203 ships with checkout-api, so its review had the workspace in view and tied one finding to the reviewer's own API PR.
  await openTriage(page, 1203)
  await expect(findings(page)).toHaveCount(4)
  await expect(page.getByText('Workspace: acme')).toBeVisible()
  await expect(findingCard(page, INTEGRATION).getByRole('button', { name: 'depends on acme/checkout-api#419' })).toBeVisible()
  await screenshot(page, 'triage-workspace')

  // The desk #412 vacated goes to the PR that waited on the shelf.
  await goTo(page, 'Floor')
  await expect(hudCard(page, 'slot-1')).toContainText('#58')
  await expect(counter(page, 'queued')).toHaveText('0 queued')
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you', { timeout: 20_000 })
  await expect(triageBadge(page)).toHaveText('2')

  await goTo(page, 'Log')
  await expect(page.getByText('3 missions', { exact: true })).toBeVisible()
  const row = logRow(page, 412)
  await expect(row.locator('[data-state="watching"]')).toBeVisible()
  await expect(row).toContainText('Vhagar')
  await expect(row).toContainText('Blind review')
  await expect(row.getByRole('button', { name: 'Open posted comment' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Open pull request #412' })).toBeVisible()
  await expect(logRow(page, 1203).locator('[data-state="needs_you"]')).toBeVisible()
  await expect(logRow(page, 58).locator('[data-state="needs_you"]')).toBeVisible()
  await screenshot(page, 'log')

  expect(errorsOn(page)).toEqual([])
})

import { expect, test } from '@playwright/test'
import {
  VIEWPORT,
  closeDemoControls,
  counter,
  demoAction,
  dispatch,
  errorsOn,
  findings,
  goTo,
  hudCard,
  hudChip,
  logRow,
  missionItem,
  newPushTag,
  openApp,
  openTriage,
  postComment,
  screenshot,
  setAutoRounds,
  watchingBanner
} from './ui'

test.use({ viewport: VIEWPORT })

test('a push re-runs the review, a push while watching queues a follow-up on the same desk, and a merge closes it', async ({ page }) => {
  await openApp(page)
  await setAutoRounds(page, 3)
  await dispatch(page, 412)
  await goTo(page, 'Floor')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you')

  await demoAction(page, 'Push to #412')
  await expect(counter(page, 'new push')).toHaveText('1 new push')
  await expect(newPushTag(page).first()).toBeVisible()
  await closeDemoControls(page)
  await screenshot(page, 'floor-new-push-needs-you')
  await openTriage(page, 412)
  await expect(missionItem(page, 412)).toContainText('new push')
  const stale = page.getByRole('status').filter({ hasText: 'The author pushed' })
  await expect(stale).toBeVisible()
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()

  await stale.getByRole('button', { name: 'Re-run' }).click()
  await expect(page.getByText('Round 2', { exact: true })).toBeVisible()
  await expect(stale).toHaveCount(0)
  await expect(findings(page)).toHaveCount(4)
  await expect(missionItem(page, 412)).toContainText('R2 · 4 findings')

  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(page.getByText('4 approved', { exact: true })).toBeVisible()
  await postComment(page)
  await expect(watchingBanner(page)).toBeVisible()
  await expect(page.getByText('Review of', { exact: false })).toContainText('round 2')

  await goTo(page, 'Floor')
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(hudChip(page, 'slot-1')).toHaveText('Idle')
  await demoAction(page, 'Push to #412')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you')
  await expect(hudCard(page, 'slot-1')).toContainText('round 3')
  await expect(counter(page, 'watching')).toHaveText('0 watching')

  await openTriage(page, 412)
  await expect(page.getByText('Round 3', { exact: true })).toBeVisible()
  await expect(missionItem(page, 412)).toContainText('Vhagar')
  // Follow-up rounds only re-check what the first round left as nits and praise.
  await expect(findings(page)).toHaveCount(1)
  await expect(findings(page).first()).toContainText('Unused import')

  await demoAction(page, 'Merge #412')
  await goTo(page, 'Triage')
  await expect(page.getByText('Mission closed (PR merged).')).toBeVisible()
  await expect(page.getByText('Preparing → Reviewing', { exact: true })).toHaveCount(3)
  await expect(page.getByText('Reviewing → Needs you', { exact: true })).toHaveCount(3)
  await expect(page.getByText('Posting → Watching', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Watching → Queued', { exact: true })).toHaveCount(1)

  await goTo(page, 'Log')
  const row = logRow(page, 412)
  await expect(row.locator('[data-state="closed"]')).toBeVisible()
  await expect(row.getByRole('cell').nth(4)).toHaveText('3')
  await expect(row.getByRole('button', { name: 'Open posted comment' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()

  expect(errorsOn(page)).toEqual([])
})

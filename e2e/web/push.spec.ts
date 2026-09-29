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
  statusLine,
  watchingBanner
} from './ui'

test.use({ viewport: VIEWPORT })

test("a push re-runs the review, the author's reply plus a push queues a follow-up on the same desk, and a merge closes it", async ({ page }) => {
  await openApp(page)
  await setAutoRounds(page, 3)
  await dispatch(page, 412)
  await goTo(page, 'Floor')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you')

  await demoAction(page, 'Push to #412')
  await expect(counter(page, 'updates')).toHaveText('1 update')
  await expect(newPushTag(page).first()).toBeVisible()
  await closeDemoControls(page)
  await screenshot(page, 'floor-new-push-needs-you')
  await openTriage(page, 412)
  await expect(missionItem(page, 412)).toContainText('new push')
  await expect(statusLine(page)).toContainText('after this round, so its findings may be out of date')
  await expect(page.locator('[data-round="1"]')).toBeVisible()

  await statusLine(page).getByRole('button', { name: 'Review the delta' }).click()
  await expect(page.locator('[data-round="2"]')).toBeVisible()
  await expect(statusLine(page)).not.toContainText('out of date')
  await expect(findings(page)).toHaveCount(4)
  await expect(page.getByRole('tab', { name: /Round 2/ })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(page.getByText('4 approved', { exact: true })).toBeVisible()
  await postComment(page)
  await expect(watchingBanner(page)).toBeVisible()
  await expect(page.getByText('Review of', { exact: false }).first()).toContainText('round 2')

  await goTo(page, 'Floor')
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(hudChip(page, 'slot-1')).toHaveText('Idle')
  await demoAction(page, 'Push to #412')
  // A push on its own waits for the author's answer.
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(hudChip(page, 'slot-1')).toHaveText('Idle')
  await demoAction(page, 'Author replies on #412')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you')
  await expect(hudCard(page, 'slot-1')).toContainText('round 3')
  await expect(counter(page, 'watching')).toHaveText('0 watching')

  await openTriage(page, 412)
  await expect(page.locator('[data-round="3"]')).toBeVisible()
  await expect(page.getByText("started by the author's reply")).toBeVisible()
  await expect(missionItem(page, 412)).toContainText('dami-codes')
  // Follow-up rounds only re-check what the first round left as nits and praise.
  await expect(findings(page)).toHaveCount(1)
  await expect(findings(page).first()).toContainText('Unused import')

  await demoAction(page, 'Merge #412')
  await goTo(page, 'Triage')
  await expect(statusLine(page)).toContainText('This review is closed (PR merged).')
  await expect(missionItem(page, 412)).toHaveCount(0)
  const history = page.getByLabel('History', { exact: true }).last()
  await expect(history).toContainText('Round 1')
  await expect(history).toContainText('Round 2')
  await expect(history).toContainText('Round 3')

  await goTo(page, 'Log')
  const row = logRow(page, 412)
  await expect(row.locator('[data-state="closed"]')).toBeVisible()
  await expect(row.getByRole('cell').nth(5)).toHaveText('3')
  await expect(row.getByRole('button', { name: 'Open posted comment' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)

  expect(errorsOn(page)).toEqual([])
})

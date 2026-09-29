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
  hudChip,
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

const AUTO_FOLLOW_UP = 'Automatic follow-ups for this review'

/** Dispatches #412 with instant steps, approves everything and posts, leaving the review watching. */
async function postFirstRound(page: Parameters<typeof openApp>[0]): Promise<void> {
  await dispatch(page, 412)
  await openTriage(page, 412)
  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(page.getByText('4 approved', { exact: true })).toBeVisible()
  await postComment(page)
  await expect(watchingBanner(page)).toBeVisible()
}

function toast(page: Parameters<typeof openApp>[0], title: string) {
  return page.getByRole('status').filter({ hasText: title })
}

test("a push alone waits for the author's reply, and the reply starts the follow-up", async ({ page }) => {
  await openApp(page)
  await setAutoRounds(page, 3)
  await postFirstRound(page)

  const toggle = page.getByRole('switch', { name: AUTO_FOLLOW_UP })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText("0 of 3 used. Each needs the author's reply and a push.")).toBeVisible()

  // Switched off for this review, a push only raises the flag.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await demoAction(page, 'Push to #412')
  await expect(toast(page, 'New push on #412')).toContainText('Automatic follow-ups are off for this review.')
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(counter(page, 'queued')).toHaveText('0 queued')
  await expect(hudChip(page, 'slot-1')).toHaveText('Idle')
  await expect(counter(page, 'updates')).toHaveText('1 update')
  await expect(newPushTag(page).first()).toBeVisible()
  await closeDemoControls(page)
  await screenshot(page, 'floor-new-push')

  await openTriage(page, 412)
  await expect(missionItem(page, 412)).toContainText('new push')
  await expect(statusLine(page)).toContainText('dami-codes pushed')
  await expect(statusLine(page)).toContainText('Automatic follow-ups are off for this review.')

  // Back on, the push still waits: only the author's reply starts a round.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Refresh inbox' }).click()
  await expect(statusLine(page)).toContainText('A follow-up starts when dami-codes replies to the review.')
  await expect(page.locator('[data-round="2"]')).toHaveCount(0)

  await demoAction(page, 'Author replies on #412')
  await openTriage(page, 412)
  await expect(page.locator('[data-round="2"]')).toBeVisible()
  await expect(page.getByText("started by the author's reply")).toBeVisible()
  await expect(page.getByText("dami-codes's reply")).toBeVisible()
  await expect(findings(page)).toHaveCount(1)
  await expect(missionItem(page, 412)).not.toContainText('new push')

  expect(errorsOn(page)).toEqual([])
})

test('with automatic follow-ups off in Settings, the user reviews the delta by hand', async ({ page }) => {
  await openApp(page)
  await goTo(page, 'Settings')
  await expect(page.getByLabel('Automatic follow-up rounds')).toHaveValue('0')

  await postFirstRound(page)
  await expect(page.getByText('Automatic follow-ups are off in Settings.', { exact: false }).first()).toBeVisible()
  await demoAction(page, 'Push to #412')
  await demoAction(page, 'Author replies on #412')
  await expect(toast(page, 'New push on #412')).toContainText('Automatic follow-ups are off in Settings.')
  await expect(counter(page, 'watching')).toHaveText('1 watching')

  await openTriage(page, 412)
  await expect(missionItem(page, 412)).toContainText('replied')
  await expect(statusLine(page)).toContainText('dami-codes replied and pushed')
  await statusLine(page).getByRole('button', { name: 'Review the delta' }).click()
  await expect(page.locator('[data-round="2"]')).toBeVisible()
  await expect(findings(page)).toHaveCount(1)
  await expect(missionItem(page, 412)).not.toContainText('new push')
  await expect(missionItem(page, 412)).not.toContainText('replied')

  expect(errorsOn(page)).toEqual([])
})

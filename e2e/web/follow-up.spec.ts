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
  watchingBanner
} from './ui'

test.use({ viewport: VIEWPORT })

const AUTO_FOLLOW_UP = 'Re-review automatically when the author pushes'

/** Dispatches #412 with instant steps, approves everything and posts, leaving the mission watching. */
async function postFirstRound(page: Parameters<typeof openApp>[0]): Promise<void> {
  await dispatch(page, 412)
  await openTriage(page, 412)
  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(page.getByText('4 approved', { exact: true })).toBeVisible()
  await postComment(page)
  await expect(watchingBanner(page)).toBeVisible()
}

function pushToast(page: Parameters<typeof openApp>[0]) {
  return page.getByRole('status').filter({ hasText: 'New push on #412' })
}

function pausedBanner(page: Parameters<typeof openApp>[0]) {
  return page.getByRole('status').filter({ hasText: 'automatic follow-up is paused' })
}

test('with auto follow-up off a push marks the watching mission stale; switching it back on re-queues at the next poll', async ({ page }) => {
  await openApp(page)
  await setAutoRounds(page, 3)
  await postFirstRound(page)

  const toggle = page.getByRole('switch', { name: AUTO_FOLLOW_UP })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('0 of 3 automatic rounds used')).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  await demoAction(page, 'Push to #412')
  await expect(pushToast(page)).toContainText('Auto follow-up is off. Re-run when ready.')
  await expect(counter(page, 'watching')).toHaveText('1 watching')
  await expect(counter(page, 'queued')).toHaveText('0 queued')
  await expect(hudChip(page, 'slot-1')).toHaveText('Idle')
  await expect(counter(page, 'new push')).toHaveText('1 new push')
  await expect(newPushTag(page).first()).toBeVisible()
  await closeDemoControls(page)
  await screenshot(page, 'floor-new-push')

  await openTriage(page, 412)
  await expect(missionItem(page, 412)).toContainText('new push')
  await expect(pausedBanner(page)).toBeVisible()
  await expect(watchingBanner(page)).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Refresh inbox' }).click()
  await expect(page.getByText('Round 2', { exact: true })).toBeVisible()
  await expect(findings(page)).toHaveCount(1)
  await expect(pausedBanner(page)).toHaveCount(0)

  expect(errorsOn(page)).toEqual([])
})

test('the automatic round cap pauses follow-ups until the user re-runs by hand', async ({ page }) => {
  await openApp(page)
  await goTo(page, 'Settings')
  await expect(page.getByLabel('Automatic follow-up rounds')).toHaveValue('0')

  await postFirstRound(page)
  await expect(page.getByText('0 of 0 automatic rounds used')).toBeVisible()
  await demoAction(page, 'Push to #412')
  await expect(pushToast(page)).toContainText('Auto follow-up limit (0) reached. Re-run when ready.')
  await expect(counter(page, 'watching')).toHaveText('1 watching')

  await openTriage(page, 412)
  await pausedBanner(page).getByRole('button', { name: 'Re-run' }).click()
  await expect(page.getByText('Round 2', { exact: true })).toBeVisible()
  await expect(findings(page)).toHaveCount(1)
  await expect(missionItem(page, 412)).not.toContainText('new push')

  expect(errorsOn(page)).toEqual([])
})

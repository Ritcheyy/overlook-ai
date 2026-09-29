import { expect, test } from '@playwright/test'
import { VIEWPORT, demoAction, dispatch, errorsOn, findings, goTo, hudCard, hudChip, missionList, openApp, openTriage, statusLine, triageBadge } from './ui'

test.use({ viewport: VIEWPORT })

/** TOKENS.rose from the floor palette. */
const ROSE = 'rgb(244, 114, 140)'

test('a failed review shows on the floor and in triage, and retry succeeds', async ({ page }) => {
  await openApp(page)
  await demoAction(page, 'Fail next review')
  await dispatch(page, 412)

  await goTo(page, 'Floor')
  const card = hudCard(page, 'slot-1')
  const chip = hudChip(page, 'slot-1')
  await expect(chip).toHaveText('Failed')
  await expect(chip).toHaveCSS('color', ROSE)
  await expect(card.getByRole('alert')).toContainText('rate limit reached')
  await expect(card.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(triageBadge(page)).toHaveCount(0)

  await openTriage(page, 412)
  await expect(missionList(page).getByRole('region', { name: 'Failed' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'rate limit reached' })).toContainText('claude exited with code 1: rate limit reached')
  await expect(statusLine(page)).toContainText('The review failed: claude exited with code 1: rate limit reached')
  await expect(page.locator('[data-state="failed"]').first()).toBeVisible()

  await statusLine(page).getByRole('button', { name: 'Retry' }).click()
  await expect(findings(page)).toHaveCount(4)
  await expect(page.locator('[data-state="needs_you"]').first()).toBeVisible()
  await expect(missionList(page).getByRole('region', { name: 'Needs you' })).toBeVisible()
  await expect(missionList(page).getByRole('region', { name: 'Failed' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Post to GitHub' })).toBeVisible()
  await expect(triageBadge(page)).toHaveText('1')

  await goTo(page, 'Floor')
  await expect(chip).toHaveText('Needs you')
  await expect(card.getByRole('alert')).toHaveCount(0)

  expect(errorsOn(page)).toEqual([])
})

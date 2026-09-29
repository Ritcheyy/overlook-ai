/**
 * Page-level helpers shared by the web specs. Everything here talks to the
 * UI the way a user would (rail, buttons, chips); nothing reaches into the
 * engine.
 */
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openWebApp } from '../helpers'

export const VIEWPORT = { width: 1440, height: 900 }

/** Chip labels the floor HUD shows for a desk; "Idle" when nobody sits there. */
const HUD_STATE = /^(Idle|Queued|Preparing|Reviewing|Needs you|Posting|Watching|Failed|Closed)$/
/** Long enough for toasts to leave and the character poses to settle before a screenshot. */
const SETTLE_MS = 1200

export type ScreenName = 'Floor' | 'Inbox' | 'Triage' | 'Log' | 'Settings'
export type SlotId = 'slot-1' | 'slot-2'

const pageErrors = new WeakMap<Page, Error[]>()

/** Loads the demo at `stepMs` per fake step and waits for the first inbox poll to land. */
export async function openApp(page: Page, stepMs = 0): Promise<void> {
  const errors: Error[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (e) => errors.push(e))
  await openWebApp(page, { stepMs })
  await expect(page.getByText('@ritchey')).toBeVisible()
}

/** Uncaught exceptions the page threw since `openApp`. */
export function errorsOn(page: Page): string[] {
  return (pageErrors.get(page) ?? []).map((e) => e.message)
}

export function rail(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Screens' })
}

export async function goTo(page: Page, screen: ScreenName): Promise<void> {
  const button = rail(page).getByRole('button', { name: new RegExp(`^${screen}`) })
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'page')
}

/** The amber counter on the Triage rail button; absent when nothing needs you. */
export function triageBadge(page: Page): Locator {
  return rail(page).getByRole('button', { name: /^Triage/ }).locator('[aria-label$="need you"]')
}

function numberSpan(page: Page, number: number): Locator {
  return page.locator('span', { hasText: new RegExp(`^#${number}$`) })
}

export function inboxRow(page: Page, number: number): Locator {
  return page.getByRole('listitem').filter({ has: numberSpan(page, number) })
}

/** Starts a review of a PR with the default review type and waits for its row to show the review state. */
export async function dispatch(page: Page, number: number): Promise<void> {
  await goTo(page, 'Inbox')
  const row = inboxRow(page, number)
  await row.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(row.locator('[data-state]')).toBeVisible()
}

/** Raises the automatic follow-up cap in Settings; the shipped default of 0 never re-runs on its own. */
export async function setAutoRounds(page: Page, cap: number): Promise<void> {
  await goTo(page, 'Settings')
  const field = page.getByLabel('Automatic follow-up rounds')
  await field.fill(String(cap))
  await field.press('Enter')
  await expect(page.getByText('Saved', { exact: true }).first()).toHaveClass(/opacity-100/)
  await expect(field).toHaveValue(String(cap))
}

export function hudCard(page: Page, slotId: SlotId): Locator {
  return page.locator(`[data-slot="${slotId}"]`)
}

export function hudChip(page: Page, slotId: SlotId): Locator {
  return hudCard(page, slotId).getByText(HUD_STATE)
}

export function counter(page: Page, label: 'queued' | 'needs you' | 'watching' | 'updates'): Locator {
  // "1 update" and "2 updates" both count as the updates counter.
  const pattern = label === 'updates' ? 'updates?' : label
  return page.getByText(new RegExp(`^\\d+ ${pattern}$`))
}

/** The amber "new push" tag under a waving character or on a HUD card; corkboard cards name their PR, as "#412 new push". */
export function newPushTag(page: Page): Locator {
  return page.getByText(/^(#\d+ )?new push$/)
}

/** Runs one of the floor's demo actions, e.g. 'Push to #412' or 'Fail next review'. */
export async function demoAction(page: Page, label: string): Promise<void> {
  await goTo(page, 'Floor')
  const toggle = page.getByRole('button', { name: 'Demo controls' })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByRole('menu', { name: 'Demo controls' }).getByRole('menuitem', { name: label, exact: true }).click()
}

/** Folds the demo menu back up after `demoAction`, so a screenshot shows the floor alone. */
export async function closeDemoControls(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Demo controls' })
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
}

export function missionList(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Reviews' })
}

/** The one-line status under the details header, with the action that moves the review on. */
export function statusLine(page: Page): Locator {
  return page.locator('[data-status]')
}

export function missionItem(page: Page, number: number): Locator {
  return missionList(page).getByRole('button').filter({ has: numberSpan(page, number) })
}

export async function openTriage(page: Page, number: number): Promise<void> {
  await goTo(page, 'Triage')
  const item = missionItem(page, number)
  await item.click()
  await expect(item).toHaveAttribute('aria-current', 'true')
}

export function findings(page: Page): Locator {
  return page.getByRole('list', { name: 'Findings' }).getByRole('listitem')
}

export function findingCard(page: Page, title: string): Locator {
  return findings(page).filter({ hasText: title })
}

export async function decide(page: Page, title: string, choice: 'Approve' | 'Drop'): Promise<void> {
  const card = findingCard(page, title)
  await card.getByRole('group', { name: /^Decision for:/ }).getByRole('button', { name: choice, exact: true }).click()
  await expect(card).toHaveAttribute('data-decision', choice === 'Approve' ? 'approved' : 'dropped')
}

export async function postComment(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Post to GitHub' }).click()
  await page.getByRole('alertdialog', { name: 'Confirm posting' }).getByRole('button', { name: 'Post', exact: true }).click()
}

export function watchingBanner(page: Page): Locator {
  return statusLine(page).filter({ hasText: 'Watching for' })
}

export function logRow(page: Page, number: number): Locator {
  return page.getByRole('row').filter({ has: numberSpan(page, number) })
}

export async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' })
  for (let i = 0; i < 10 && (await dismiss.count()) > 0; i++) {
    await dismiss.first().click({ timeout: 2000 }).catch(() => undefined)
  }
}

/** Saves e2e/screenshots/<name>.png at the test viewport once toasts are gone and the scene has settled. */
export async function screenshot(page: Page, name: string): Promise<void> {
  await dismissToasts(page)
  await page.waitForTimeout(SETTLE_MS)
  await page.screenshot({ path: join(test.info().config.rootDir, 'e2e', 'screenshots', `${name}.png`), fullPage: false })
}

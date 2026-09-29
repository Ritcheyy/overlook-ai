import { resolve } from 'node:path'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { AppSnapshot } from '@core/domain'

export const SCREENSHOT_DIR = resolve('e2e/screenshots')
export const WINDOW_SIZE = { width: 1440, height: 900 }

export type ScreenName = 'Floor' | 'Inbox' | 'Triage' | 'Log' | 'Settings'

export function rail(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Screens' })
}

export async function goTo(page: Page, screen: ScreenName): Promise<void> {
  await rail(page).getByRole('button', { name: new RegExp(`^${screen}`) }).click()
}

export function inboxRow(page: Page, number: number): Locator {
  return page.getByRole('listitem').filter({ has: page.getByText(`#${number}`, { exact: true }) })
}

export function slotCard(page: Page, slotId = 'slot-1'): Locator {
  return page.locator(`[data-slot="${slotId}"]`)
}

export function findings(page: Page): Locator {
  return page.getByRole('list', { name: 'Findings' }).getByRole('listitem')
}

/** The rail badge on Triage reads "<n> reviews need you". */
export function needsYouBadge(page: Page, count: number): Locator {
  return rail(page).getByLabel(`${count} reviews need you`)
}

/** Sends a seed PR to the floor from the inbox and waits for its row to switch to a mission chip. */
export async function dispatchFromInbox(page: Page, number: number): Promise<void> {
  await goTo(page, 'Inbox')
  const row = inboxRow(page, number)
  await row.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(row.locator('[data-state]')).toBeVisible()
}

export function snapshotOf(page: Page): Promise<AppSnapshot> {
  return page.evaluate(() => window.bridge!.invoke('getSnapshot'))
}

/** Pins the content area to the screenshot size; screenshots are taken in CSS pixels regardless of the display's scale. */
export async function ensureWindowSize(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, WINDOW_SIZE)
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([WINDOW_SIZE.width, WINDOW_SIZE.height])
}

/** Waits for animations to settle, then saves e2e/screenshots/<name>.png at 1440x900. */
export async function screenshot(page: Page, name: string, settleMs = 1200): Promise<void> {
  await page.waitForTimeout(settleMs)
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${name}.png`), fullPage: false, scale: 'css' })
}

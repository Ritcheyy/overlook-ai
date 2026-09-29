import { expect, test, type Page } from '@playwright/test'
import { VIEWPORT, errorsOn, goTo, hudCard, openApp, screenshot } from './ui'

test.use({ viewport: VIEWPORT })

const STORAGE_KEY = 'overlook-demo-state'

interface StoredDemoState {
  settings: { pollIntervalSec: number; slots: { id: string; name: string }[] }
}

function readStored(page: Page): Promise<StoredDemoState | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as StoredDemoState) : null
  }, STORAGE_KEY)
}

test('poll interval and reviewer names survive a reload', async ({ page }) => {
  await openApp(page)
  await goTo(page, 'Settings')

  const poll = page.getByLabel('Poll interval')
  await expect(poll).toHaveValue('30')
  await poll.fill('45')
  await poll.press('Enter')
  await expect(page.getByText('Saved', { exact: true }).first()).toHaveClass(/opacity-100/)
  await expect(poll).toHaveValue('45')

  const reviewer1 = page.getByLabel('Reviewer 1')
  await expect(reviewer1).toHaveValue('Vhagar')
  await reviewer1.fill('Ripley')
  await reviewer1.press('Enter')
  await expect(reviewer1).toHaveValue('Ripley')
  await expect(page.getByLabel('Ripley color hex')).toHaveValue('#f5b544')

  await expect.poll(async () => (await readStored(page))?.settings.pollIntervalSec).toBe(45)
  await expect.poll(async () => (await readStored(page))?.settings.slots[0]?.name).toBe('Ripley')

  await page.reload()
  await expect(page.getByText('@ritchey')).toBeVisible()
  await goTo(page, 'Settings')
  await expect(page.getByLabel('Poll interval')).toHaveValue('45')
  await expect(page.getByLabel('Reviewer 1')).toHaveValue('Ripley')
  await expect(page.getByLabel('Reviewer 2')).toHaveValue('Nova')
  await expect(page.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Automatic follow-up rounds')).toHaveValue('0')

  // The demo engine answers the preflight itself, so every row is ok without touching gh or claude.
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Claude' }).click()
  await expect(page.getByRole('list', { name: 'Environment checks' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check environment' }).click()
  const checks = page.getByRole('list', { name: 'Environment checks' })
  await expect(checks.getByRole('listitem')).toHaveText([/^GitHub CLI/, /^Claude Code/, /^Git/, /^Worktree root/])
  await expect(checks.getByRole('img', { name: 'ok' })).toHaveCount(4)
  await expect(checks.getByRole('img', { name: 'failed' })).toHaveCount(0)
  await expect(checks).toContainText('/Users/demo/.overlook/worktrees')
  await expect(page.getByText(/^Checked /)).toBeVisible()
  await screenshot(page, 'settings')

  // The scan found the acme container; it starts switched on because the folder carries a CLAUDE.md.
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Repositories' }).click()
  const workspace = page.getByRole('group', { name: 'Workspace acme' })
  await expect(workspace).toContainText('detected')
  await expect(workspace).toContainText('/Users/demo/Projects/acme')
  await expect(workspace).toContainText('acme/storefront-web')
  await expect(workspace.getByRole('switch', { name: 'acme enabled' })).toHaveAttribute('aria-checked', 'true')
  await expect(workspace.getByRole('switch', { name: 'Share acme notes with reviews' })).toHaveAttribute('aria-checked', 'true')
  await screenshot(page, 'settings-workspaces')

  await goTo(page, 'Floor')
  await expect(hudCard(page, 'slot-1')).toContainText('Ripley')
  await expect(hudCard(page, 'slot-2')).toContainText('Nova')

  expect(errorsOn(page)).toEqual([])
})

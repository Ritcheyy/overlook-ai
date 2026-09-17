import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { PersistedState } from '@core/ports'
import { launchElectron, type ElectronHarness } from '../helpers'
import { dispatchFromInbox, ensureWindowSize, findings, goTo, inboxRow, needsYouBadge, rail, screenshot, slotCard, snapshotOf } from './ui'

const SEED = [
  { number: 412, repo: 'acme/checkout-api', title: 'fix(refunds): make refund creation idempotent per order' },
  { number: 419, repo: 'acme/checkout-api', title: 'feat(auth): return sessionExpiresIn and set refresh cookie on /' },
  { number: 1203, repo: 'acme/storefront-web', title: 'feat(cart): persist promo code across sessions' },
  { number: 1210, repo: 'acme/storefront-web', title: 'feat(floor-plan): seat picker with live availability' },
  { number: 77, repo: 'acme/mobile-app', title: 'chore: bump react-native to 0.76 and fix hermes flags' },
  { number: 58, repo: 'acme/notifications-service', title: 'feat: retry webhook deliveries with exponential backoff' }
]

test.describe.configure({ mode: 'serial' })

let h: ElectronHarness
let closed = false
const consoleErrors: string[] = []
const pageErrors: string[] = []

test.beforeAll(async () => {
  h = await launchElectron()
  h.page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  h.page.on('pageerror', (e) => pageErrors.push(e.message))
  await ensureWindowSize(h.app, h.page)
})

test.afterAll(async () => {
  if (!closed) await h.app.close().catch(() => undefined)
  rmSync(h.userData, { recursive: true, force: true })
})

test('opens in demo mode with a fresh profile', async () => {
  const { app, page } = h
  await expect(page).toHaveTitle('Overlook')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))).toEqual(['Overlook'])

  const navigation = page.getByRole('complementary', { name: 'Navigation' })
  await expect(navigation.getByRole('button', { name: 'DEMO' })).toBeVisible()
  await expect(navigation.getByText('@ritchey')).toBeVisible()
  await expect(navigation.getByText(/^Synced/)).toBeVisible()
  await expect(rail(page).getByRole('button', { name: /^Floor/ })).toHaveAttribute('aria-current', 'page')

  const snapshot = await snapshotOf(page)
  expect(snapshot.settings.demoMode).toBe(true)
  expect(snapshot.missions).toEqual([])
  expect(snapshot.slots.map((s) => s.id)).toEqual(['slot-1', 'slot-2'])
  expect(snapshot.localRepos.map((r) => r.fullName)).toContain('acme/checkout-api')
  expect(existsSync(join(h.userData, 'state.json'))).toBe(true)

  await expect(page.locator('[data-floor]')).toBeVisible()
  test.info().annotations.push({ type: 'floor', description: (await page.locator('[data-floor]').getAttribute('data-floor')) ?? 'missing' })
  await expect(slotCard(page, 'slot-1')).toContainText('Idle')
  await expect(slotCard(page, 'slot-2')).toContainText('Idle')
  await screenshot(page, 'electron-floor-idle')
})

test('lists the seed pull requests in the inbox', async () => {
  const { page } = h
  await goTo(page, 'Inbox')
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(SEED.length)
  for (const pr of SEED) {
    const row = inboxRow(page, pr.number)
    await expect(row).toContainText(pr.title)
    await expect(page.getByRole('region', { name: pr.repo })).toContainText(`#${pr.number}`)
    await expect(row.getByRole('button', { name: 'Review', exact: true })).toBeEnabled()
  }
  await expect(page.getByText('mine', { exact: true })).toHaveCount(2)
  await screenshot(page, 'electron-inbox')
})

test('dispatches a review and stops in needs_you', async () => {
  const { page } = h
  await dispatchFromInbox(page, 412)

  await goTo(page, 'Floor')
  const card = slotCard(page, 'slot-1')
  await expect(card).toContainText('#412')
  await expect(card.getByText('Reviewing')).toBeVisible({ timeout: 30_000 })
  await screenshot(page, 'electron-floor')
  await expect(card.locator('li')).not.toHaveCount(0)

  await expect(needsYouBadge(page, 1)).toBeVisible({ timeout: 60_000 })
  await expect(card.getByText('Needs you')).toBeVisible()
  await screenshot(page, 'electron-floor-needs-you')

  await goTo(page, 'Triage')
  await expect(page.getByRole('region', { name: 'Needs you' })).toContainText('#412')
  await expect(findings(page)).toHaveCount(4)
  await expect(page.getByRole('list', { name: 'Findings' })).toContainText('Two partial refunds of equal amount share one idempotency key')
  await screenshot(page, 'electron-triage')

  const snapshot = await snapshotOf(page)
  expect(snapshot.missions).toHaveLength(1)
  expect(snapshot.missions[0]).toMatchObject({ prId: 'acme/checkout-api#412', state: 'needs_you', slotId: 'slot-1', loadoutId: 'blind' })
  expect(snapshot.missions[0].rounds[0].findings.map((f) => f.decision)).toEqual(['pending', 'pending', 'pending', 'pending'])
  expect(snapshot.slots.find((s) => s.id === 'slot-1')?.missionId).toBe(snapshot.missions[0].id)
})

test('closes cleanly and leaves the mission in state.json', async () => {
  const { app, userData } = h
  const process = app.process()
  await app.close()
  closed = true
  expect(process.exitCode).toBe(0)

  const persisted = JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8')) as PersistedState
  expect(persisted.settings.demoMode).toBe(true)
  expect(persisted.inbox).toHaveLength(SEED.length)
  expect(persisted.missions.map((m) => [m.prId, m.state])).toEqual([['acme/checkout-api#412', 'needs_you']])
  expect(existsSync(join(userData, 'state.json.tmp'))).toBe(false)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

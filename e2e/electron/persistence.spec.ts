import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { PersistedState } from '@core/ports'
import { launchElectron, type ElectronHarness } from '../helpers'
import { dispatchFromInbox, ensureWindowSize, findings, goTo, inboxRow, needsYouBadge, screenshot, slotCard, snapshotOf } from './ui'

test.describe.configure({ mode: 'serial' })
test.setTimeout(150_000)

let userData: string | undefined
let open: ElectronHarness | undefined

async function launch(): Promise<ElectronHarness> {
  open = await launchElectron({ userData })
  userData = open.userData
  await ensureWindowSize(open.app, open.page)
  return open
}

async function close(): Promise<void> {
  await open?.app.close()
  open = undefined
}

test.afterEach(async () => {
  await close().catch(() => undefined)
  if (userData) rmSync(userData, { recursive: true, force: true })
  userData = undefined
})

test('a mission waiting for triage survives a restart on the same profile', async () => {
  const first = await launch()
  await dispatchFromInbox(first.page, 412)
  await expect(needsYouBadge(first.page, 1)).toBeVisible({ timeout: 60_000 })
  const before = await snapshotOf(first.page)
  expect(before.missions).toHaveLength(1)
  const mission = before.missions[0]
  expect(mission).toMatchObject({ prId: 'acme/checkout-api#412', state: 'needs_you', slotId: 'slot-1' })
  await close()

  const persisted = JSON.parse(readFileSync(join(userData!, 'state.json'), 'utf8')) as PersistedState
  expect(persisted.missions.map((m) => [m.id, m.state])).toEqual([[mission.id, 'needs_you']])

  const second = await launch()
  await expect(needsYouBadge(second.page, 1)).toBeVisible()
  const after = await snapshotOf(second.page)
  expect(after.missions.map((m) => ({ id: m.id, state: m.state, slotId: m.slotId, rounds: m.rounds.length }))).toEqual([
    { id: mission.id, state: 'needs_you', slotId: 'slot-1', rounds: 1 }
  ])
  expect(after.missions[0].timeline.map((e) => e.to)).toEqual(mission.timeline.map((e) => e.to))
  expect(after.slots.find((s) => s.id === 'slot-1')?.missionId).toBe(mission.id)
  expect(after.inbox.map((p) => p.id)).toContain('acme/checkout-api#412')
  expect(after.inbox).toHaveLength(before.inbox.length)

  await expect(slotCard(second.page, 'slot-1')).toContainText('#412')
  await expect(slotCard(second.page, 'slot-1').getByText('Needs you')).toBeVisible()
  await screenshot(second.page, 'electron-floor-after-restart')

  await goTo(second.page, 'Inbox')
  const row = inboxRow(second.page, 412)
  await expect(row).toContainText('fix(refunds): make refund creation idempotent per order')
  await expect(row.locator('[data-state="needs_you"]')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0)
  await screenshot(second.page, 'electron-inbox-after-restart')

  await goTo(second.page, 'Triage')
  await expect(second.page.getByRole('region', { name: 'Needs you' })).toContainText('#412')
  await expect(findings(second.page)).toHaveCount(4)
  await screenshot(second.page, 'electron-triage-after-restart')
})

test('settings changes survive a restart', async () => {
  const first = await launch()
  await first.page.evaluate(() => window.bridge!.invoke('updateSettings', { signature: 'Reviewed on the floor', pollIntervalSec: 45 }))
  await close()

  const second = await launch()
  const snapshot = await snapshotOf(second.page)
  expect(snapshot.settings).toMatchObject({ signature: 'Reviewed on the floor', pollIntervalSec: 45, demoMode: true })
  expect(snapshot.missions).toEqual([])
})

import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { AppSnapshot } from '@core/domain'
import { launchElectron, type ElectronHarness } from '../helpers'

type Invoke = (method: string, ...args: unknown[]) => Promise<unknown>

interface Rejection {
  isError: boolean
  name: string
  message: string
}

let h: ElectronHarness

test.beforeAll(async () => {
  h = await launchElectron()
})

test.afterAll(async () => {
  await h.app.close().catch(() => undefined)
  rmSync(h.userData, { recursive: true, force: true })
})

/** Runs `bridge.invoke` in the renderer and reports how it rejected, or null when it resolved. */
function rejectionOf(method: string, ...args: unknown[]): Promise<Rejection | null> {
  return h.page.evaluate(
    async ([method, args]) => {
      try {
        await (window.bridge!.invoke as unknown as Invoke)(method, ...args)
        return null
      } catch (e) {
        const err = e as Error
        return { isError: e instanceof Error, name: err.name, message: err.message }
      }
    },
    [method, args] as const
  )
}

test('exposes a frozen bridge with invoke and on', async () => {
  const shape = await h.page.evaluate(() => ({
    keys: Object.keys(window.bridge ?? {}).sort(),
    invoke: typeof window.bridge?.invoke,
    on: typeof window.bridge?.on,
    frozen: Object.isFrozen(window.bridge)
  }))
  expect(shape).toEqual({ keys: ['invoke', 'on'], invoke: 'function', on: 'function', frozen: true })
})

test('a bad mission id rejects in the renderer with the engine message', async () => {
  await expect(h.page.evaluate(() => window.bridge!.invoke('postComment', 'nope'))).rejects.toThrow('Review not found: nope')
  for (const method of ['postComment', 'cancelMission', 'retryMission', 'rerunMission', 'closeMission', 'previewComment']) {
    expect(await rejectionOf(method, 'nope'), method).toEqual({ isError: true, name: 'Error', message: 'Review not found: nope' })
  }
  expect(await rejectionOf('setFindingDecision', { missionId: 'nope', roundId: 'r', findingId: 'f', decision: 'approved' })).toMatchObject({
    message: 'Review not found: nope'
  })
  expect(await rejectionOf('setFindingDecisions', { missionId: 'nope', roundId: 'r', decision: 'dropped' })).toMatchObject({
    message: 'Review not found: nope'
  })
})

test('bad arguments reject with readable messages', async () => {
  expect(await rejectionOf('dispatch', { prId: 'nope' })).toMatchObject({ isError: true, message: 'PR not found: nope' })
  expect(await rejectionOf('dispatch', { prId: 'acme/checkout-api#9999' })).toMatchObject({ message: /^PR not found: acme\/checkout-api#9999/ })
  expect(await rejectionOf('dispatch', { prId: 'acme/checkout-api#412', loadoutId: 'nope' })).toMatchObject({ message: 'Unknown review type: nope' })
  expect(await rejectionOf('dispatch')).toMatchObject({ isError: true, message: expect.stringContaining('prId') })
  expect(await rejectionOf('demoSimulate', { kind: 'push' })).toMatchObject({ message: "prId is required for 'push'" })
  expect(await rejectionOf('demoSimulate', { kind: 'merge', prId: 'nope' })).toMatchObject({ message: 'PR nope not found' })
  expect(await rejectionOf('updateSettings', { pollIntervalSec: 1 })).toMatchObject({ message: 'pollIntervalSec must be at least 15' })
  expect(await rejectionOf('updateSettings', { defaultLoadoutId: 'nope' })).toMatchObject({ message: "defaultLoadoutId 'nope' is not one of the loadouts" })
  expect(await rejectionOf('nope')).toMatchObject({ isError: true, message: "No handler registered for 'api:nope'" })
})

test('rejections carry no IPC wrapper prefix', async () => {
  const rejection = await rejectionOf('cancelMission', 'nope')
  expect(rejection?.message).not.toMatch(/invoking remote method/)
  expect(rejection?.message).not.toMatch(/^Error:/)
})

test('lookups that are not errors resolve normally', async () => {
  expect(await h.page.evaluate(() => window.bridge!.invoke('getActivity', 'nope'))).toEqual([])
  expect(await h.page.evaluate(() => window.bridge!.invoke('previewComment', 'nope').catch(() => 'rejected'))).toBe('rejected')
  await expect(h.page.evaluate(() => window.bridge!.invoke('demoSimulate', { kind: 'fail_next_review' }))).resolves.toBeUndefined()
})

test('the engine keeps answering after rejected calls', async () => {
  await rejectionOf('postComment', 'nope')
  const snapshot = await h.page.evaluate(() => window.bridge!.invoke('getSnapshot'))
  expect(snapshot.settings.demoMode).toBe(true)
  expect(snapshot.missions).toEqual([])
  await expect(h.page.getByRole('complementary', { name: 'Navigation' }).getByText('@ritchey')).toBeVisible()
})

test('push subscriptions deliver snapshots and can be unsubscribed', async () => {
  const result = await h.page.evaluate(async () => {
    const received: AppSnapshot[] = []
    const off = window.bridge!.on('snapshot', (s) => received.push(s))
    await window.bridge!.invoke('refreshInbox')
    await new Promise((r) => setTimeout(r, 200))
    const whileSubscribed = received.length
    off()
    await window.bridge!.invoke('refreshInbox')
    await new Promise((r) => setTimeout(r, 200))
    return { whileSubscribed, afterOff: received.length, inbox: received[0]?.inbox.length }
  })
  expect(result.whileSubscribed).toBeGreaterThan(0)
  expect(result.afterOff).toBe(result.whileSubscribed)
  expect(result.inbox).toBe(6)
})

test('a dispatch that the UI would refuse still rejects with the reason', async () => {
  const mission = await h.page.evaluate(() => window.bridge!.invoke('dispatch', { prId: 'acme/checkout-api#419' }))
  // A free character picks the mission up before dispatch returns, so it is already preparing.
  expect(['queued', 'preparing']).toContain(mission.state)
  expect(await rejectionOf('dispatch', { prId: 'acme/checkout-api#419' })).toMatchObject({ message: '#419 already has an active review' })
  expect(await rejectionOf('postComment', mission.id)).toMatchObject({ message: '#419 has no review round to post' })
  expect(await rejectionOf('retryMission', mission.id)).toMatchObject({ message: expect.stringMatching(/^Cannot retry from state '/) })
  expect(await rejectionOf('rerunMission', mission.id)).toMatchObject({ message: expect.stringMatching(/^Cannot rerun from state '/) })

  await h.page.evaluate((id) => window.bridge!.invoke('cancelMission', id), mission.id)
  await expect.poll(async () => (await h.page.evaluate(() => window.bridge!.invoke('getSnapshot'))).missions[0]?.state).toBe('failed')
  expect(await rejectionOf('cancelMission', mission.id)).toMatchObject({ message: "Cannot cancel from state 'failed'" })
})

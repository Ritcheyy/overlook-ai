import { describe, expect, it } from 'vitest'
import type { AppSnapshot } from '../domain'
import { createDemoEngine, createDemoStore, DEMO_STORAGE_KEY, persistedDemoSeed } from './engine'

async function waitFor(get: () => Promise<AppSnapshot>, pred: (s: AppSnapshot) => boolean, timeoutMs = 4000): Promise<AppSnapshot> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const s = await get()
    if (pred(s)) return s
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 4))
  }
}

describe('createDemoEngine', () => {
  it('dispatches a seeded PR and reaches needs_you with zero real calls', async () => {
    const engine = createDemoEngine({ stepMs: 0 })
    await engine.start()
    try {
      const snap = await engine.api.refreshInbox()
      expect(snap.settings.demoMode).toBe(true)
      expect(snap.settings.pollIntervalSec).toBe(30)
      expect(snap.version).toBe('demo')
      expect(snap.githubLogin).toBe('ritchey')
      expect(snap.inbox.length).toBeGreaterThan(0)
      expect(snap.slots).toHaveLength(2)
      const m = await engine.api.dispatch({ prId: 'acme/checkout-api#412' })
      const done = await waitFor(engine.api.getSnapshot, (s) => s.missions.find((x) => x.id === m.id)?.state === 'needs_you')
      const mission = done.missions.find((x) => x.id === m.id)!
      expect(mission.rounds[0].findings.length).toBe(4)
      expect(mission.worktreePath).toBe('/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412')
      const preview = await engine.api.previewComment(m.id)
      expect(preview.length).toBeGreaterThan(0)
      await engine.api.demoSimulate({ kind: 'push', prId: 'acme/checkout-api#412' })
      expect((await engine.api.getSnapshot()).missions[0].stale).toBe(true)
    } finally {
      await engine.stop()
    }
  })

  it('seeds the fake GitHub from the persisted inbox so simulated PRs survive a reload', async () => {
    const data = new Map<string, string>()
    const g = globalThis as unknown as { localStorage?: unknown }
    g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    try {
      const first = createDemoEngine({ stepMs: 0 })
      await first.start()
      await first.api.refreshInbox()
      await first.api.demoSimulate({ kind: 'new_pr' })
      await first.api.demoSimulate({ kind: 'merge', prId: 'acme/mobile-app#77' })
      const created = (await first.api.getSnapshot()).inbox.find((p) => p.number === 901)
      expect(created).toBeDefined()
      await first.stop()
      expect(JSON.parse(data.get(DEMO_STORAGE_KEY)!).inbox.length).toBeGreaterThan(0)

      const second = createDemoEngine({ stepMs: 0 })
      await second.start()
      try {
        const snap = await second.api.refreshInbox()
        expect(snap.inbox.some((p) => p.id === created!.id)).toBe(true)
        expect(snap.inbox.some((p) => p.id === 'acme/mobile-app#77')).toBe(false)
        await second.api.demoSimulate({ kind: 'new_pr' })
        const numbers = (await second.api.getSnapshot()).inbox.map((p) => p.number)
        expect(numbers).toContain(902)
        expect(numbers.filter((n) => n === 901)).toHaveLength(1)
      } finally {
        await second.stop()
      }
    } finally {
      delete g.localStorage
    }
  })

  it('ignores an empty or malformed persisted inbox', () => {
    expect(persistedDemoSeed(null)).toBeUndefined()
    expect(persistedDemoSeed({ missions: [], inbox: [], settings: {} as never })).toBeUndefined()
    expect(persistedDemoSeed({ missions: [], inbox: [{ id: 'x' } as never], settings: {} as never })).toBeUndefined()
  })

  it('reports an all-ok environment and treats relaunch as a no-op', async () => {
    const engine = createDemoEngine({ stepMs: 0 })
    await engine.start()
    try {
      expect((await engine.api.getSnapshot()).environment).toBeUndefined()
      const env = await engine.api.checkEnvironment()
      expect(env.ok).toBe(true)
      expect(env.items.map((i) => [i.id, i.ok, i.detail])).toEqual([
        ['gh', true, 'demo login'],
        ['claude', true, 'demo reviewer'],
        ['git', true, 'demo'],
        ['worktreeRoot', true, '/Users/demo/.overlook/worktrees']
      ])
      expect((await engine.api.getSnapshot()).environment).toEqual(env)
      await expect(engine.api.relaunch()).resolves.toBeUndefined()
    } finally {
      await engine.stop()
    }
  })

  it('honours the version option', async () => {
    const engine = createDemoEngine({ stepMs: 0, version: 'web-demo' })
    await engine.start()
    try {
      expect((await engine.api.getSnapshot()).version).toBe('web-demo')
    } finally {
      await engine.stop()
    }
  })
})

describe('createDemoStore', () => {
  it('falls back to memory without localStorage and uses localStorage when present', async () => {
    const store = createDemoStore()
    const initial = await store.load()
    expect(initial?.settings.pollIntervalSec).toBe(30)
    expect(initial?.settings.demoMode).toBe(true)
    await store.save({ ...initial!, lastPollAt: 'x' })
    expect((await store.load())?.lastPollAt).toBe('x')

    const data = new Map<string, string>()
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v)
    }
    const g = globalThis as unknown as { localStorage?: unknown }
    g.localStorage = fake
    try {
      const ls = createDemoStore()
      const loaded = await ls.load()
      await ls.save({ ...loaded!, lastPollAt: 'persisted' })
      expect(JSON.parse(data.get(DEMO_STORAGE_KEY)!).lastPollAt).toBe('persisted')
      expect((await createDemoStore().load())?.lastPollAt).toBe('persisted')

      g.localStorage = {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        }
      }
      const blocked = createDemoStore()
      expect((await blocked.load())?.settings.demoMode).toBe(true)
      await blocked.save({ ...loaded!, lastPollAt: 'mem' })
      expect((await blocked.load())?.lastPollAt).toBe('mem')
    } finally {
      delete g.localStorage
    }
  })
})

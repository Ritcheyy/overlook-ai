import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PersistedState } from '@core/ports'
import { defaultSettings } from '@core/loadouts'
import { JsonFileStore } from './json-store'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'prr-store-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function state(overrides: Partial<PersistedState> = {}): PersistedState {
  return { missions: [], settings: defaultSettings(), inbox: [], lastPollAt: '2026-09-13T12:00:00Z', ...overrides }
}

describe('JsonFileStore', () => {
  it('returns null when the file does not exist', async () => {
    expect(await new JsonFileStore(join(dir, 'missing', 'state.json')).load()).toBeNull()
  })

  it('round-trips state, creating the directory and leaving no tmp file', async () => {
    const file = join(dir, 'nested', 'deeper', 'state.json')
    const store = new JsonFileStore(file)
    const s = state({ settings: defaultSettings({ demoMode: false, pollIntervalSec: 30 }) })
    await store.save(s)
    expect(await store.load()).toEqual(s)
    expect(await fs.readdir(join(dir, 'nested', 'deeper'))).toEqual(['state.json'])
  })

  it('moves a corrupt file aside and returns null', async () => {
    const file = join(dir, 'state.json')
    await fs.writeFile(file, '{"missions": [')
    const store = new JsonFileStore(file)
    expect(await store.load()).toBeNull()
    const names = await fs.readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^state\.json\.corrupt-\d{4}-\d{2}-\d{2}T/)
    expect(await fs.readFile(join(dir, names[0]!), 'utf8')).toBe('{"missions": [')
    expect(await store.load()).toBeNull()
  })

  it('treats valid JSON that is not an object as corrupt', async () => {
    const file = join(dir, 'state.json')
    await fs.writeFile(file, '[1, 2]')
    expect(await new JsonFileStore(file).load()).toBeNull()
    expect((await fs.readdir(dir))[0]).toMatch(/corrupt/)
  })

  it('keeps the previous file intact when a later save overwrites it', async () => {
    const file = join(dir, 'state.json')
    const store = new JsonFileStore(file)
    await store.save(state({ lastPollAt: 'first' }))
    await store.save(state({ lastPollAt: 'second' }))
    expect((await store.load())?.lastPollAt).toBe('second')
  })

  it('serialises overlapping saves so the last one wins', async () => {
    const file = join(dir, 'state.json')
    const store = new JsonFileStore(file)
    await Promise.all([1, 2, 3, 4, 5].map((n) => store.save(state({ lastPollAt: `save-${n}` }))))
    expect((await store.load())?.lastPollAt).toBe('save-5')
    expect(await fs.readdir(dir)).toEqual(['state.json'])
  })
})

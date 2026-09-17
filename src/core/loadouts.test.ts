import { describe, expect, it } from 'vitest'
import { BUILT_IN_LOADOUTS, RETIRED_SLASH_COMMANDS, SKILL_MESSAGE_EXAMPLE, defaultSettings } from './loadouts'

describe('defaultSettings', () => {
  it('defaults to the opus alias, no automatic follow-ups and the signature template', () => {
    const s = defaultSettings()
    expect(s.claudeModel).toBe('opus')
    expect(s.claudeFallbackModel).toBeUndefined()
    expect(s.maxAutoRoundsPerMission).toBe(0)
    expect(s.signature).toBe('{loadout} · Reviewed by {character} · {approval}')
  })

  it('keeps an explicit empty model and applies overrides', () => {
    expect(defaultSettings({ claudeModel: '' }).claudeModel).toBe('')
    expect(defaultSettings({ maxAutoRoundsPerMission: 3 }).maxAutoRoundsPerMission).toBe(3)
  })

  it('sends every built-in loadout through the plain prompt and retires the slash command it once shipped', () => {
    expect(BUILT_IN_LOADOUTS.every((l) => l.slashCommand === undefined)).toBe(true)
    expect(RETIRED_SLASH_COMMANDS).toEqual(['/code-review {number} high'])
    expect(SKILL_MESSAGE_EXAMPLE).toContain('#{number}')
    expect(SKILL_MESSAGE_EXAMPLE.startsWith('/')).toBe(false)
  })
})

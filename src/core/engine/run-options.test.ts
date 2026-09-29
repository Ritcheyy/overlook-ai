import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../loadouts'
import { MAX_REPLIES, MAX_REPLY_CHARS, applyRunOptions, sanitizeRunOptions, trimReplies } from './run-options'

describe('sanitizeRunOptions', () => {
  it('keeps well-formed choices and drops the rest', () => {
    expect(sanitizeRunOptions({ model: ' sonnet ', effort: 'low', maxBudgetUsd: 2, autoPost: true })).toEqual({ model: 'sonnet', effort: 'low', maxBudgetUsd: 2, autoPost: true })
    expect(sanitizeRunOptions({ effort: 'extreme' as never, maxBudgetUsd: -1 })).toBeUndefined()
    expect(sanitizeRunOptions({ model: '', effort: '' })).toEqual({ model: '', effort: '' })
    expect(sanitizeRunOptions(undefined)).toBeUndefined()
  })
})

describe('applyRunOptions', () => {
  it('overrides only what was chosen, with empty strings meaning the CLI default', () => {
    const settings = defaultSettings({ claudeModel: 'opus', claudeEffort: 'max', maxBudgetUsdPerReview: 15 })
    expect(applyRunOptions(settings, undefined)).toBe(settings)
    const next = applyRunOptions(settings, { model: 'sonnet', maxBudgetUsd: 3 })
    expect(next).toMatchObject({ claudeModel: 'sonnet', claudeEffort: 'max', maxBudgetUsdPerReview: 3 })
    expect(applyRunOptions(settings, { model: '', effort: '' })).toMatchObject({ claudeModel: '', claudeEffort: undefined })
    expect(settings.claudeModel).toBe('opus')
  })

  it('drops the fallback for a run that switches to the fallback model itself', () => {
    const settings = defaultSettings({ claudeModel: 'opus', claudeFallbackModel: 'sonnet' })
    expect(applyRunOptions(settings, { model: 'sonnet' }).claudeFallbackModel).toBeUndefined()
    expect(applyRunOptions(settings, { model: 'fable' }).claudeFallbackModel).toBe('sonnet')
  })
})

describe('trimReplies', () => {
  it('keeps the newest replies, oldest first, and truncates long bodies', () => {
    const replies = Array.from({ length: MAX_REPLIES + 2 }, (_, i) => ({
      url: `https://github.com/a/b/pull/1#issuecomment-${i}`,
      author: 'dami-codes',
      body: i === MAX_REPLIES + 1 ? 'x'.repeat(MAX_REPLY_CHARS + 10) : `reply ${i}`,
      createdAt: new Date(Date.UTC(2026, 8, 13, 12, i)).toISOString()
    })).reverse()
    const trimmed = trimReplies(replies)
    expect(trimmed).toHaveLength(MAX_REPLIES)
    expect(trimmed[0].body).toBe('reply 2')
    expect(trimmed[MAX_REPLIES - 1].body.endsWith('[reply truncated]')).toBe(true)
  })
})

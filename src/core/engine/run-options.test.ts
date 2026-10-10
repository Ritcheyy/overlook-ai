import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../loadouts'
import { MAX_REPLIES, MAX_REPLY_CHARS, applyRunOptions, engineOf, runBudgetUsd, runEffort, runModel, sanitizeRunOptions, trimReplies } from './run-options'

describe('engine helpers', () => {
  it('treat settings without an engine as Claude Code and read the model, effort and budget of the selected CLI', () => {
    const claude = defaultSettings({ claudeModel: 'opus', claudeEffort: 'max', maxBudgetUsdPerReview: 15, cursorModel: 'gpt-5.2' })
    expect(engineOf({ reviewerEngine: undefined as never })).toBe('claude')
    expect([runModel(claude), runEffort(claude), runBudgetUsd(claude)]).toEqual(['opus', 'max', 15])
    const cursor = { ...claude, reviewerEngine: 'cursor' as const }
    expect([runModel(cursor), runEffort(cursor), runBudgetUsd(cursor)]).toEqual(['gpt-5.2', undefined, undefined])
  })
})

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

  it('sets the Cursor model for a Cursor run and leaves the Claude settings alone', () => {
    const settings = defaultSettings({ reviewerEngine: 'cursor', claudeModel: 'opus', claudeFallbackModel: 'sonnet', cursorModel: '' })
    expect(applyRunOptions(settings, { model: 'sonnet' })).toMatchObject({ cursorModel: 'sonnet', claudeModel: 'opus', claudeFallbackModel: 'sonnet' })
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

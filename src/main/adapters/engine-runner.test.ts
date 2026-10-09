import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@core/loadouts'
import type { ReviewRequest, ReviewResult, RunnerPort } from '@core/ports'
import { makeRequest } from '@core/review/test-helpers'
import { EngineRunner } from './engine-runner'

function recorder(name: string): RunnerPort & { calls: ReviewRequest[] } {
  const calls: ReviewRequest[] = []
  return {
    calls,
    async review(req): Promise<ReviewResult> {
      calls.push(req)
      return { findings: [], summary: name, verdict: 'approve' }
    }
  }
}

describe('EngineRunner', () => {
  it('routes each review to the CLI its settings name, defaulting to Claude Code', async () => {
    const claude = recorder('claude')
    const cursor = recorder('cursor')
    const runner = new EngineRunner({ claude, cursor })
    expect((await runner.review(makeRequest({ settings: defaultSettings({ reviewerEngine: 'cursor' }) }))).summary).toBe('cursor')
    expect((await runner.review(makeRequest({ settings: defaultSettings() }))).summary).toBe('claude')
    expect((await runner.review(makeRequest({ settings: { ...defaultSettings(), reviewerEngine: undefined as never } }))).summary).toBe('claude')
    expect(claude.calls).toHaveLength(2)
    expect(cursor.calls).toHaveLength(1)
  })
})

import type { ReviewRequest, ReviewResult, RunnerPort } from '../ports'
import { demoReviewFor } from '../demo/seed'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    })
  })

/**
 * Scripted reviewer. Emits the seed activity lines with a delay between them
 * and returns the seed findings. Never touches Claude. `stepMs` = 0 makes it
 * effectively instant for tests.
 */
export class MockRunner implements RunnerPort {
  failNext = false
  calls: ReviewRequest[] = []

  constructor(public stepMs = 0) {}

  async review(req: ReviewRequest): Promise<ReviewResult> {
    this.calls.push(req)
    const script = demoReviewFor(req.mission.prId)
    const started = Date.now()
    req.onModel?.('demo-reviewer')
    for (const step of script.activity) {
      req.onActivity?.({ kind: step.kind, text: step.text })
      await sleep(this.stepMs, req.signal)
    }
    if (this.failNext) {
      this.failNext = false
      throw new Error('claude exited with code 1: rate limit reached')
    }
    const isFollowUp = !!req.previousRound
    const findings = isFollowUp ? script.findings.filter((f) => f.severity === 'nit' || f.severity === 'praise') : script.findings
    return {
      findings: structuredClone(findings),
      summary: isFollowUp ? `Follow-up on ${req.round.headSha.slice(0, 7)}: the earlier findings are addressed. ${script.summary}` : script.summary,
      verdict: isFollowUp ? 'approve' : script.verdict,
      briefing: isFollowUp
        ? `Since ${req.previousRound!.headSha.slice(0, 7)}: the author addressed the earlier findings and pushed no unrelated changes.\n- No new endpoints, schema changes, flags or dependencies.\n- Nothing new to know before merging.`
        : script.briefing,
      rawOutput: JSON.stringify({ summary: script.summary, findings }, null, 2),
      costUsd: 0,
      durationMs: Date.now() - started,
      model: 'demo-reviewer'
    }
  }
}

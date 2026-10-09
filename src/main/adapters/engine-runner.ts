/**
 * Hands each review to the CLI the settings name at the time it starts, so
 * switching engines in Settings needs no restart.
 */
import type { ReviewerEngine } from '@core/domain'
import { engineOf } from '@core/engine/run-options'
import type { ReviewRequest, ReviewResult, RunnerPort } from '@core/ports'

export class EngineRunner implements RunnerPort {
  constructor(private readonly runners: Record<ReviewerEngine, RunnerPort>) {}

  review(req: ReviewRequest): Promise<ReviewResult> {
    return this.runners[engineOf(req.settings)].review(req)
  }
}

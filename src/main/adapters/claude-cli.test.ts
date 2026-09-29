import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Activity } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import type { ReviewRequest } from '@core/ports'
import { BUILT_IN_LOADOUTS, SKILL_MESSAGE_EXAMPLE } from '@core/loadouts'
import { MAX_INLINE_DIFF_CHARS, buildReviewPrompt } from '@core/review/prompt'
import { REVIEW_JSON_SCHEMA } from '@core/review/schema'
import { HEAD_SHA, PREV_SHA, makeRequest, makeRound, makeWorkspace } from '@core/review/test-helpers'
import { ALLOWED_TOOLS, ClaudeCliRunner, HEADLESS_PREAMBLE, type ClaudeCliRunnerOptions, type SpawnFn, type SpawnOpts } from './claude-cli'
import type { ExecFn, ExecOptions, ExecResult } from './exec'

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4242
  kills: string[] = []
  stdinText = ''
  closed = false

  constructor(private readonly ignoreSigterm: boolean) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.stdinText += chunk.toString()
    })
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal)
    if (signal === 'SIGTERM' && this.ignoreSigterm) return true
    this.exit(null, signal)
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.closed) return
    this.closed = true
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code, signal))
  }
}

interface SpawnCall {
  command: string
  args: string[]
  opts: SpawnOpts
  child: FakeChild
}

type Script = (child: FakeChild) => void

function fakeSpawn(script: Script, opts: { ignoreSigterm?: boolean } = {}) {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = (command, args, o) => {
    const child = new FakeChild(opts.ignoreSigterm ?? false)
    calls.push({ command, args, opts: o, child })
    // Replay only after the prompt has been fully written, like a real CLI reading stdin.
    child.stdin.on('end', () => script(child))
    return child
  }
  return { spawn, calls }
}

const line = (obj: unknown) => JSON.stringify(obj) + '\n'
const assistant = (...content: unknown[]) => line({ type: 'assistant', message: { role: 'assistant', content } })
const toolUse = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id: 't1', name, input })

const structured = {
  summary: 'One bug, one nit.',
  verdict: 'request_changes',
  findings: [
    { severity: 'major', category: 'correctness', title: 'Bug', body: 'Why.', file: './src/a.ts', line: 10 },
    { severity: 'nit', category: 'style', title: 'Nit', body: 'Meh.' }
  ]
}

/** What Claude Code's code-review skill hands to the host instead of the structured output. */
const reportFindingsInput = {
  findings: [
    {
      file: 'src/refunds/refund.service.ts',
      line: 48,
      summary: 'Two refunds of the same amount collide on the idempotency key.',
      failure_scenario: 'Retry a refund with a different reason: the second one is dropped.',
      category: 'correctness',
      short_summary: 'Refund key collision',
      verdict: 'CONFIRMED'
    },
    { file: 'src/refunds/refund.service.ts', summary: 'The lookup runs once per refund.', category: 'efficiency', verdict: 'PLAUSIBLE' }
  ]
}

const resultLine = (overrides: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    structured_output: structured,
    total_cost_usd: 0.31,
    duration_ms: 4200,
    num_turns: 5,
    session_id: 's1',
    ...overrides
  })

function successScript(child: FakeChild): void {
  child.stdout.write(line({ type: 'system', subtype: 'init', model: 'claude-x' }))
  child.stdout.write(assistant({ type: 'text', text: '  Let me start by reading   the diff and then the service.  ' }))
  child.stdout.write(assistant(toolUse('Read', { file_path: '/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412/src/a.ts' })))
  child.stdout.write(assistant(toolUse('Glob', { pattern: 'src/**/*.spec.ts' })))
  child.stdout.write(assistant(toolUse('LS', { path: '/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412/src' })))
  child.stdout.write(line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }))
  child.stdout.write(assistant(toolUse('Grep', { pattern: 'createRefund', path: 'src' })))
  child.stdout.write(assistant(toolUse('Bash', { command: 'git diff origin/main...HEAD --stat' })))
  child.stdout.write('this line is not json\n')
  child.stdout.write(assistant(toolUse('StructuredOutput', { summary: 'x' })))
  // Split the result line across two chunks to exercise the line buffer.
  const result = resultLine()
  child.stdout.write(result.slice(0, 40))
  child.stdout.write(result.slice(40))
  child.exit(0)
}

function request(overrides: Partial<ReviewRequest> = {}): { req: ReviewRequest; activity: Omit<Activity, 'missionId' | 'at'>[] } {
  const activity: Omit<Activity, 'missionId' | 'at'>[] = []
  const req = makeRequest({ onActivity: (a) => activity.push(a), ...overrides })
  return { req, activity }
}

interface ExecCall {
  cmd: string
  args: string[]
  opts?: ExecOptions
}

/** Answers git and the claudePath lookups; anything the handler leaves undefined fails like a missing binary. */
function fakeExec(handler: (cmd: string, args: string[]) => ExecResult | undefined = () => undefined) {
  const calls: ExecCall[] = []
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return handler(cmd, args) ?? { stdout: '', stderr: `${cmd}: not found`, code: 127 }
  }
  return { exec, calls }
}

const execOk = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })

/** A runner whose lookups never touch a real shell; pass `exec` to script them. */
function makeRunner(opts: ClaudeCliRunnerOptions): ClaudeCliRunner {
  return new ClaudeCliRunner({ exec: fakeExec().exec, ...opts })
}

function followUpRequest(overrides: Partial<ReviewRequest> = {}) {
  const previousRound = makeRound({ id: 'round-1', index: 1, headSha: PREV_SHA, finishedAt: '2026-09-13T10:20:00.000Z' })
  const round = makeRound({ id: 'round-2', index: 2, headSha: HEAD_SHA, previousHeadSha: PREV_SHA })
  return request({ diff: '', previousRound, round, ...overrides })
}

describe('ClaudeCliRunner', () => {
  it('spawns claude with the expected args, cwd, env and prompt on stdin', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const env = { PATH: '/usr/bin', HOME: '/Users/demo', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }
    const runner = makeRunner({ spawn, env })
    const settings = defaultSettings({
      claudePath: '/opt/bin/claude',
      claudeModel: 'claude-opus-4-1',
      claudeFallbackModel: 'sonnet',
      claudeEffort: 'high',
      maxAutoRoundsPerMission: 3,
      maxBudgetUsdPerReview: 2.5
    })
    const { req } = request({ settings })

    await runner.review(req)

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.command).toBe('/opt/bin/claude')
    expect(call.args.slice(0, 8)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--setting-sources',
      'user',
      '--strict-mcp-config'
    ])
    expect(call.args[call.args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(REVIEW_JSON_SCHEMA))
    expect(call.args[call.args.indexOf('--max-budget-usd') + 1]).toBe('2.5')
    const toolsAt = call.args.indexOf('--allowedTools')
    expect(call.args.slice(toolsAt + 1, toolsAt + 1 + ALLOWED_TOOLS.length)).toEqual([
      'Read',
      'Grep',
      'Glob',
      'LS',
      'Bash(git diff:*)',
      'Bash(git log:*)',
      'Bash(git show:*)',
      'Bash(git blame:*)',
      'Bash(git status:*)',
      'Bash(gh pr diff:*)',
      'Bash(gh pr view:*)'
    ])
    expect(call.args).not.toContain('--append-system-prompt')
    expect(call.args).not.toContain('--add-dir')
    expect(call.args).not.toContain('Bash(gh pr list:*)')
    expect(call.args.some((a) => a.startsWith('Bash(git -C'))).toBe(false)
    expect(call.args[call.args.indexOf('--model') + 1]).toBe('claude-opus-4-1')
    expect(call.args[call.args.indexOf('--fallback-model') + 1]).toBe('sonnet')
    expect(call.args[call.args.indexOf('--effort') + 1]).toBe('high')
    expect(call.opts.cwd).toBe(req.worktreePath)
    expect(call.opts.stdio).toBe('pipe')
    expect(call.opts.env.PATH).toBe('/usr/bin')
    expect(call.opts.env).not.toHaveProperty('CLAUDECODE')
    expect(call.opts.env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT')
    expect(env.CLAUDECODE).toBe('1')
    expect(call.child.stdinText).toContain('fix(refunds): make refund creation idempotent per order')
    expect(call.child.stdinText).toContain('git diff origin/main...HEAD')
  })

  it('sends the loadout slash command as the message and the review prompt as an appended system prompt', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { req } = request({ loadout: { ...BUILT_IN_LOADOUTS[0], slashCommand: '/code-review {number} high' } })

    await makeRunner({ spawn }).review(req)

    const call = calls[0]
    expect(call.child.stdinText).toBe('/code-review 412 high')
    const appended = call.args[call.args.indexOf('--append-system-prompt') + 1]
    expect(appended.startsWith(`${HEADLESS_PREAMBLE}\n\n`)).toBe(true)
    expect(appended).toBe(`${HEADLESS_PREAMBLE}\n\n${buildReviewPrompt(req)}`)
    expect(appended).toContain('fix(refunds): make refund creation idempotent per order')
    expect(call.args).toContain('Bash(gh pr diff:*)')
    expect(call.args).toContain('Bash(gh pr view:*)')
    expect(call.args[call.args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(REVIEW_JSON_SCHEMA))
  })

  it('writes a prose message override to stdin verbatim and appends the headless preamble', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { req } = request({ loadout: { ...BUILT_IN_LOADOUTS[0], slashCommand: SKILL_MESSAGE_EXAMPLE } })

    await makeRunner({ spawn }).review(req)

    const call = calls[0]
    expect(call.child.stdinText).toBe('Use the code-review skill at level high on pull request #412, then return the review as the structured output.')
    const appended = call.args[call.args.indexOf('--append-system-prompt') + 1]
    expect(appended).toContain(
      'If you use a skill, run it inside this conversation and, when it is done, return the review through the structured output; the ReportFindings tool is optional and the app will read it if you call it.'
    )
    expect(appended).toBe(`${HEADLESS_PREAMBLE}\n\n${buildReviewPrompt(req)}`)
  })

  it('opens the workspace container and the sibling checkouts to a workspace review', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { req } = request({ workspace: makeWorkspace() })

    await makeRunner({ spawn }).review(req)

    const { args } = calls[0]
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/Users/demo/Projects/acme')
    const toolsAt = args.indexOf('--allowedTools')
    expect(args.slice(toolsAt + 1, args.indexOf('--model'))).toEqual([
      ...ALLOWED_TOOLS,
      'Bash(gh pr list:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web fetch:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web show:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web log:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web diff:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web grep:*)',
      'Bash(git -C /Users/demo/Projects/storefront-web ls-files:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app fetch:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app show:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app log:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app diff:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app grep:*)',
      'Bash(git -C /Users/demo/Projects/mobile-app ls-files:*)'
    ])
    expect(calls[0].child.stdinText).toContain('## Workspace')
    expect(calls[0].child.stdinText).toContain('acme/storefront-web#1210')
  })

  it('grants the PR listing but no --add-dir for a manual workspace without a container', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { req } = request({ workspace: makeWorkspace({ rootPath: undefined, siblings: [{ fullName: 'acme/mobile-app' }] }) })
    await makeRunner({ spawn }).review(req)
    const { args } = calls[0]
    expect(args).not.toContain('--add-dir')
    expect(args).toContain('Bash(gh pr list:*)')
    expect(args.some((a) => a.startsWith('Bash(git -C'))).toBe(false)
  })

  it('passes the default opus model', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    await makeRunner({ spawn }).review(request().req)
    expect(calls[0].args[calls[0].args.indexOf('--model') + 1]).toBe('opus')
  })

  it('expands ~ in claudePath before spawning', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    await makeRunner({ spawn }).review(request({ settings: defaultSettings({ claudePath: '~/.local/bin/claude' }) }).req)
    expect(calls[0].command).toBe(`${homedir()}/.local/bin/claude`)
  })

  it('omits --model, --fallback-model and --effort when unset', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const runner = makeRunner({ spawn })
    await runner.review(request({ settings: defaultSettings({ claudeModel: undefined, claudeEffort: undefined }) }).req)
    expect(calls[0].args).not.toContain('--model')
    expect(calls[0].args).not.toContain('--fallback-model')
    expect(calls[0].args).not.toContain('--effort')
    expect(calls[0].args[calls[0].args.indexOf('--max-budget-usd') + 1]).toBe('3')
  })

  it('maps stream-json events to activities and parses the result', async () => {
    const { spawn } = fakeSpawn(successScript)
    const runner = makeRunner({ spawn })
    const { req, activity } = request()

    const result = await runner.review(req)

    expect(activity).toEqual([
      { kind: 'thinking', text: 'Starting Claude Code' },
      { kind: 'thinking', text: 'Let me start by reading the diff and then the service.' },
      { kind: 'reading', text: 'src/a.ts' },
      { kind: 'reading', text: 'src/**/*.spec.ts' },
      { kind: 'reading', text: 'src' },
      { kind: 'searching', text: 'createRefund' },
      { kind: 'running', text: 'git diff origin/main...HEAD --stat' },
      { kind: 'writing', text: 'Writing findings' }
    ])
    expect(result.summary).toBe('One bug, one nit.')
    expect(result.verdict).toBe('request_changes')
    expect(result.findings).toEqual([
      { severity: 'major', category: 'correctness', title: 'Bug', body: 'Why.', file: 'src/a.ts', line: 10 },
      { severity: 'nit', category: 'style', title: 'Nit', body: 'Meh.' }
    ])
    expect(result.costUsd).toBe(0.31)
    expect(result.durationMs).toBe(4200)
    expect(result.model).toBe('claude-x')
  })

  it('reports the init event model once, as soon as it arrives', async () => {
    const order: string[] = []
    const { spawn } = fakeSpawn(successScript)
    const { req } = request({ onActivity: (a) => order.push(a.text), onModel: (m) => order.push(`model ${m}`) })
    await makeRunner({ spawn }).review(req)
    expect(order.slice(0, 3)).toEqual(['Starting Claude Code', 'model claude-x', 'Let me start by reading the diff and then the service.'])
    expect(order.filter((t) => t.startsWith('model '))).toEqual(['model claude-x'])
  })

  it('falls back to the model the result names when the init event has none', async () => {
    const reported: string[] = []
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(line({ type: 'system', subtype: 'init' }))
      child.stdout.write(resultLine({ model: 'claude-y' }))
      child.exit(0)
    })
    expect((await makeRunner({ spawn }).review(request({ onModel: (m) => reported.push(m) }).req)).model).toBe('claude-y')
    expect(reported).toEqual([])
  })

  it('reads the model that carried the spend off modelUsage, and leaves it unset when nothing names one', async () => {
    const usage = { modelUsage: { 'claude-haiku-4-5': { costUSD: 0.01 }, 'claude-opus-4-1': { costUSD: 0.3 } } }
    const withUsage = fakeSpawn((child) => {
      child.stdout.write(resultLine(usage))
      child.exit(0)
    })
    expect((await makeRunner({ spawn: withUsage.spawn }).review(request().req)).model).toBe('claude-opus-4-1')
    const bare = fakeSpawn((child) => {
      child.stdout.write(resultLine())
      child.exit(0)
    })
    expect((await makeRunner({ spawn: bare.spawn }).review(request().req)).model).toBeUndefined()
  })

  it('truncates long assistant text to 100 characters', async () => {
    const long = 'a'.repeat(250)
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(assistant({ type: 'text', text: long }))
      child.stdout.write(resultLine())
      child.exit(0)
    })
    const { req, activity } = request()
    await makeRunner({ spawn }).review(req)
    expect(activity[1]).toEqual({ kind: 'thinking', text: 'a'.repeat(100) })
  })

  it('rejects with the last stderr lines on a non-zero exit without a result', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(line({ type: 'system', subtype: 'init' }))
      child.stderr.write('warning: something\nError: rate limit reached\n')
      child.exit(1)
    })
    const { req } = request()
    await expect(makeRunner({ spawn }).review(req)).rejects.toThrow(
      'claude exited with code 1: warning: something\nError: rate limit reached'
    )
  })

  it('rejects when the CLI exits cleanly without ever printing a result', async () => {
    const { spawn } = fakeSpawn((child) => child.exit(0))
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow('claude exited without a result')
  })

  it('rejects with the result text when the result is an error', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(resultLine({ subtype: 'error_max_budget_usd', is_error: true, result: 'Budget of $3 exceeded', structured_output: undefined }))
      child.exit(1)
    })
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow('Budget of $3 exceeded')
  })

  it('rejects when the result carries no findings payload, quoting the final message and the cost', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(resultLine({ result: 'Command completed', structured_output: undefined }))
      child.exit(0)
    })
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow(
      'Claude finished without a findings payload. Its final message was: "Command completed". A slash command that runs its own flow does this; use the plain prompt for this loadout. Estimated cost $0.31.'
    )
  })

  it('appends the last stderr lines to a rejected result', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stderr.write('warning: something\nskill ran as a host command\n')
      child.stdout.write(resultLine({ result: 'Command completed', structured_output: undefined }))
      child.exit(0)
    })
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow(
      /Estimated cost \$0\.31\.\n\nLast stderr lines:\nwarning: something\nskill ran as a host command$/
    )
  })

  it('recovers the review from a ReportFindings call when the result has no payload', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(line({ type: 'system', subtype: 'init', model: 'claude-x' }))
      child.stdout.write(assistant(toolUse('Read', { file_path: '/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412/src/a.ts' })))
      // The skill delegates to a sub-agent, whose calls stream with a parent id.
      child.stdout.write(
        line({ type: 'assistant', parent_tool_use_id: 'toolu_task', message: { role: 'assistant', content: [toolUse('ReportFindings', reportFindingsInput)] } })
      )
      child.stdout.write(resultLine({ result: 'Command completed', structured_output: undefined }))
      child.exit(0)
    })
    const { req, activity } = request()

    const result = await makeRunner({ spawn }).review(req)

    expect(activity).toContainEqual({ kind: 'writing', text: 'Reporting findings' })
    expect(result.findings).toEqual([
      {
        severity: 'major',
        category: 'correctness',
        title: 'Refund key collision',
        body: 'Two refunds of the same amount collide on the idempotency key.\n\nFailure scenario: Retry a refund with a different reason: the second one is dropped.',
        file: 'src/refunds/refund.service.ts',
        line: 48
      },
      {
        severity: 'minor',
        category: 'performance',
        title: 'The lookup runs once per refund.',
        body: 'The lookup runs once per refund.',
        file: 'src/refunds/refund.service.ts'
      }
    ])
    expect(result.summary).toBe("2 findings reported by Claude Code's review skill.")
    expect(result.verdict).toBe('request_changes')
    expect(result.rawOutput).toBe(JSON.stringify(reportFindingsInput, null, 2))
    expect(result.costUsd).toBe(0.31)
    expect(result.durationMs).toBe(4200)
    expect(result.model).toBe('claude-x')
  })

  it('prefers the structured output over a ReportFindings call', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(assistant(toolUse('ReportFindings', reportFindingsInput)))
      child.stdout.write(resultLine())
      child.exit(0)
    })
    const result = await makeRunner({ spawn }).review(request().req)
    expect(result.summary).toBe('One bug, one nit.')
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0].title).toBe('Bug')
  })

  it('still rejects an error result even when findings were reported', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(assistant(toolUse('ReportFindings', reportFindingsInput)))
      child.stdout.write(resultLine({ subtype: 'error_max_budget_usd', is_error: true, result: 'Budget of $3 exceeded', structured_output: undefined }))
      child.exit(1)
    })
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow('Budget of $3 exceeded')
  })

  it('rejects when the binary cannot be started', async () => {
    const spawn: SpawnFn = () => {
      const child = new FakeChild(false)
      setImmediate(() => child.emit('error', new Error('spawn claude ENOENT')))
      return child
    }
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow('Could not start claude: spawn claude ENOENT')
  })

  it('kills the process with SIGTERM on abort and rejects with Cancelled', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined)
    const controller = new AbortController()
    const { req } = request({ signal: controller.signal })
    const pending = makeRunner({ spawn }).review(req)
    await new Promise((r) => setImmediate(r))
    controller.abort()
    await expect(pending).rejects.toThrow('Cancelled')
    expect(calls[0].child.kills).toEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined, { ignoreSigterm: true })
    const controller = new AbortController()
    const { req } = request({ signal: controller.signal })
    const pending = makeRunner({ spawn, killGraceMs: 5 }).review(req)
    await new Promise((r) => setImmediate(r))
    controller.abort()
    await expect(pending).rejects.toThrow('Cancelled')
    expect(calls[0].child.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does not spawn when the signal is already aborted', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined)
    const controller = new AbortController()
    controller.abort()
    await expect(makeRunner({ spawn }).review(request({ signal: controller.signal }).req)).rejects.toThrow('Cancelled')
    expect(calls).toHaveLength(0)
  })

  it('kills the process and rejects after the hard timeout', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined)
    const pending = makeRunner({ spawn, timeoutMs: 10 }).review(request().req)
    await expect(pending).rejects.toThrow(/timed out/)
    expect(calls[0].child.kills).toEqual(['SIGTERM'])
  })

  it('resolves a bare claudePath before spawning', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec((cmd, args) =>
      cmd === 'sh' && args[1] === 'command -v -- "$1"' && args[3] === 'claude' ? execOk('/Users/demo/.local/bin/claude\n') : undefined
    )
    const env = { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
    await makeRunner({ spawn, exec, env }).review(request({ settings: defaultSettings({ claudePath: 'claude' }) }).req)
    expect(calls[0].command).toBe('/Users/demo/.local/bin/claude')
    expect(execCalls[0]!.opts?.env?.['PATH']).toContain('/usr/bin:/bin:')
  })

  it('spawns the bare name when it cannot be resolved', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec()
    await makeRunner({ spawn, exec }).review(request({ settings: defaultSettings({ claudePath: 'claude' }) }).req)
    expect(calls[0].command).toBe('claude')
    expect(execCalls.map((c) => c.cmd)).toEqual(['sh', process.env['SHELL'] || '/bin/sh'])
  })

  it('does not look up an absolute claudePath', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec()
    await makeRunner({ spawn, exec }).review(request({ settings: defaultSettings({ claudePath: '/opt/bin/claude' }) }).req)
    expect(calls[0].command).toBe('/opt/bin/claude')
    expect(execCalls).toEqual([])
  })

  it('diffs against the previous round when no diff was supplied', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec((cmd, args) =>
      cmd === 'git' && args.includes('diff') ? execOk('diff --git a/src/b.ts b/src/b.ts\n@@ -1 +1,2 @@\n+delta line\n') : undefined
    )
    const { req } = followUpRequest()
    await makeRunner({ spawn, exec }).review(req)

    const diff = execCalls.find((c) => c.cmd === 'git')!
    expect(diff.args).toEqual(['-C', req.worktreePath, 'diff', `${PREV_SHA}..HEAD`])
    expect(diff.opts?.timeoutMs).toBe(20_000)
    const prompt = calls[0].child.stdinText
    expect(prompt).toContain(`Output of \`git diff ${PREV_SHA}..HEAD\``)
    expect(prompt).toContain('+delta line')
    expect(prompt).toContain(`Round 1 reviewed ${PREV_SHA}`)
  })

  it('leaves the diff out when git fails or the delta is too large', async () => {
    const failing = fakeExec((cmd) => (cmd === 'git' ? { stdout: '', stderr: 'fatal: bad revision', code: 128 } : undefined))
    const first = fakeSpawn(successScript)
    await makeRunner({ spawn: first.spawn, exec: failing.exec }).review(followUpRequest().req)
    expect(first.calls[0].child.stdinText).toContain(`No inline diff was provided. Run \`git diff ${PREV_SHA}..HEAD\``)

    const huge = fakeExec((cmd) => (cmd === 'git' ? execOk('+x\n'.repeat(MAX_INLINE_DIFF_CHARS / 3 + 1)) : undefined))
    const second = fakeSpawn(successScript)
    await makeRunner({ spawn: second.spawn, exec: huge.exec }).review(followUpRequest().req)
    expect(second.calls[0].child.stdinText).toContain(`No inline diff was provided. Run \`git diff ${PREV_SHA}..HEAD\``)

    const crashing = fakeExec(() => {
      throw new Error('spawn git ENOENT')
    })
    const third = fakeSpawn(successScript)
    await makeRunner({ spawn: third.spawn, exec: crashing.exec }).review(followUpRequest().req)
    expect(third.calls[0].child.stdinText).toContain('No inline diff was provided')
  })

  it('does not run git when a diff was supplied', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec()
    await makeRunner({ spawn, exec }).review(followUpRequest({ diff: 'diff --git a/x b/x\n+supplied\n', settings: defaultSettings({ claudePath: '/opt/bin/claude' }) }).req)
    expect(execCalls).toEqual([])
    expect(calls[0].child.stdinText).toContain('+supplied')
  })
})

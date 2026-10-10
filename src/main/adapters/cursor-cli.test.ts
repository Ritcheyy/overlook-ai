import { describe, expect, it } from 'vitest'
import type { Activity } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import type { ReviewRequest } from '@core/ports'
import { PREV_SHA, makeRequest, makeRound, makeWorkspace } from '@core/review/test-helpers'
import { CURSOR_ASIDE_DIR, CURSOR_PERMISSIONS, CursorActivityMapper, CursorCliRunner, buildCursorArgs, cursorActivities, type CursorCliRunnerOptions, type CursorFs } from './cursor-cli'
import type { ExecFn, ExecResult } from './exec'
import { fakeSpawn, line, type FakeChild } from './test-helpers'

const WORKTREE = makeRequest().worktreePath
const CONFIG = `${WORKTREE}/.cursor`
const ASIDE = `${WORKTREE}/${CURSOR_ASIDE_DIR}`
const AGENT = '/opt/bin/agent'

const review = {
  summary: 'One bug.',
  verdict: 'request_changes',
  briefing: 'Adds refunds.',
  findings: [{ severity: 'major', category: 'correctness', title: 'Bug', body: 'Why.', file: 'src/a.ts', line: 10 }]
}

const assistant = (text: string) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: 's1' })
const toolStarted = (tool: string, args: Record<string, unknown>) => line({ type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { [tool]: { args }, toolCallId: 'c1' }, session_id: 's1' })
const toolCompleted = (tool: string, args: Record<string, unknown>, result: Record<string, unknown>) =>
  line({ type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { [tool]: { args, result }, toolCallId: 'c1' }, session_id: 's1' })
const resultLine = (overrides: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    duration_ms: 26_808,
    duration_api_ms: 26_808,
    is_error: false,
    result: `I'll start with the diff.${JSON.stringify(review)}`,
    session_id: 's1',
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides
  })

/** The event stream the CLI printed in a real headless run, trimmed to one of each kind. */
function successScript(child: FakeChild): void {
  child.stdout.write(line({ type: 'system', subtype: 'init', apiKeySource: 'login', cwd: WORKTREE, session_id: 's1', model: 'Auto', permissionMode: 'default' }))
  child.stdout.write(line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, session_id: 's1' }))
  child.stdout.write(line({ type: 'thinking', subtype: 'delta', text: 'I will read ', session_id: 's1' }))
  child.stdout.write(line({ type: 'thinking', subtype: 'delta', text: 'the diff first.', session_id: 's1' }))
  child.stdout.write(line({ type: 'thinking', subtype: 'completed', session_id: 's1' }))
  child.stdout.write(assistant("  I'll start with   the diff.  "))
  child.stdout.write(toolStarted('readToolCall', { path: `${WORKTREE}/src/a.ts` }))
  child.stdout.write(toolCompleted('readToolCall', { path: `${WORKTREE}/src/a.ts` }, { success: { content: 'x', totalLines: 1 } }))
  child.stdout.write(toolStarted('shellToolCall', { command: 'git diff HEAD~1 --stat', workingDirectory: '' }))
  child.stdout.write(toolCompleted('shellToolCall', { command: 'git diff HEAD~1 --stat' }, { rejected: { command: 'git diff HEAD~1 --stat' } }))
  child.stdout.write(toolStarted('grepToolCall', { pattern: 'createRefund', path: WORKTREE }))
  child.stdout.write(toolStarted('listDirToolCall', { directory: `${WORKTREE}/src` }))
  child.stdout.write(toolStarted('editToolCall', { path: `${WORKTREE}/src/out.txt`, streamContent: 'done' }))
  child.stdout.write('not json\n')
  child.stdout.write(assistant(JSON.stringify(review)))
  // Split the result line across two chunks to exercise the line buffer.
  const result = resultLine()
  child.stdout.write(result.slice(0, 30))
  child.stdout.write(result.slice(30))
  child.exit(0)
}

function fakeFs(existing: string[] = []): { fs: CursorFs; ops: string[]; files: Map<string, string> } {
  const present = new Set(existing)
  const ops: string[] = []
  const files = new Map<string, string>()
  const fs: CursorFs = {
    async access(path) {
      if (!present.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    },
    async rename(from, to) {
      ops.push(`rename ${from} -> ${to}`)
      present.delete(from)
      present.add(to)
    },
    async mkdir(path) {
      ops.push(`mkdir ${path}`)
      present.add(path)
      return undefined
    },
    async writeFile(path, data) {
      ops.push(`write ${path}`)
      files.set(path, data)
      present.add(path)
    },
    async rm(path) {
      ops.push(`rm ${path}`)
      present.delete(path)
    }
  }
  return { fs, ops, files }
}

function fakeExec(handler: (cmd: string, args: string[]) => ExecResult | undefined = () => undefined) {
  const calls: { cmd: string; args: string[] }[] = []
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args })
    return handler(cmd, args) ?? { stdout: '', stderr: `${cmd}: not found`, code: 127 }
  }
  return { exec, calls }
}

function request(overrides: Partial<ReviewRequest> = {}): { req: ReviewRequest; activity: Omit<Activity, 'missionId' | 'at'>[]; models: string[] } {
  const activity: Omit<Activity, 'missionId' | 'at'>[] = []
  const models: string[] = []
  const settings = defaultSettings({ reviewerEngine: 'cursor', cursorPath: AGENT, cursorModel: 'gpt-5.2' })
  const req = makeRequest({ settings, onActivity: (a) => activity.push(a), onModel: (m) => models.push(m), ...overrides })
  return { req, activity, models }
}

function makeRunner(opts: CursorCliRunnerOptions): CursorCliRunner {
  return new CursorCliRunner({ exec: fakeExec().exec, fs: fakeFs().fs, env: { PATH: '/usr/bin' }, ...opts })
}

describe('CursorCliRunner', () => {
  it('spawns agent headless in the worktree with the prompt on stdin', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { req } = request()
    await makeRunner({ spawn }).review(req)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe(AGENT)
    expect(calls[0].args).toEqual(['-p', '--output-format', 'stream-json', '--trust', '--workspace', WORKTREE, '--model', 'gpt-5.2'])
    expect(calls[0].opts).toMatchObject({ cwd: WORKTREE, stdio: 'pipe', windowsHide: true })
    expect(calls[0].child.stdinText).toContain('Respond with a single JSON object')
  })

  it('leaves the model to Cursor when none is set', () => {
    expect(buildCursorArgs(defaultSettings({ cursorModel: '' }), WORKTREE)).not.toContain('--model')
  })

  it('sets the PR branch config aside, writes the read-only permissions, and puts the branch config back', async () => {
    const { spawn } = fakeSpawn(successScript)
    const { fs, ops, files } = fakeFs([CONFIG])
    await makeRunner({ spawn, fs }).review(request().req)
    expect(ops).toEqual([`rename ${CONFIG} -> ${ASIDE}`, `mkdir ${CONFIG}`, `write ${CONFIG}/cli.json`, `rm ${CONFIG}`, `rename ${ASIDE} -> ${CONFIG}`])
    expect(JSON.parse(files.get(`${CONFIG}/cli.json`)!)).toEqual(CURSOR_PERMISSIONS)
    expect(CURSOR_PERMISSIONS.permissions.deny).toContain('Write(**)')
  })

  it('needs no rename when the branch has no .cursor folder, and keeps a folder an interrupted run set aside', async () => {
    const plain = fakeFs()
    await makeRunner({ spawn: fakeSpawn(successScript).spawn, fs: plain.fs }).review(request().req)
    expect(plain.ops).toEqual([`mkdir ${CONFIG}`, `write ${CONFIG}/cli.json`, `rm ${CONFIG}`])

    const interrupted = fakeFs([CONFIG, ASIDE])
    await makeRunner({ spawn: fakeSpawn(successScript).spawn, fs: interrupted.fs }).review(request().req)
    expect(interrupted.ops).toEqual([`rm ${CONFIG}`, `mkdir ${CONFIG}`, `write ${CONFIG}/cli.json`, `rm ${CONFIG}`, `rename ${ASIDE} -> ${CONFIG}`])
  })

  it('maps the stream to activities, reports the model first, and reads the review out of the result text', async () => {
    const { spawn } = fakeSpawn(successScript)
    const { req, activity, models } = request()
    const result = await makeRunner({ spawn }).review(req)
    expect(models).toEqual(['Auto'])
    expect(activity).toEqual([
      { kind: 'thinking', text: 'Starting Cursor' },
      { kind: 'thinking', text: 'I will read the diff first.' },
      { kind: 'thinking', text: "I'll start with the diff." },
      { kind: 'reading', text: 'src/a.ts' },
      { kind: 'running', text: 'git diff HEAD~1 --stat' },
      { kind: 'searching', text: 'createRefund' },
      { kind: 'reading', text: 'src' },
      { kind: 'running', text: 'edit src/out.txt' },
      { kind: 'writing', text: 'Writing findings' }
    ])
    expect(result.model).toBe('Auto')
    expect(result.summary).toBe('One bug.')
    expect(result.verdict).toBe('request_changes')
    expect(result.briefing).toBe('Adds refunds.')
    expect(result.findings).toEqual([{ severity: 'major', category: 'correctness', title: 'Bug', body: 'Why.', file: 'src/a.ts', line: 10 }])
    expect(result.durationMs).toBe(26_808)
    expect(result.costUsd).toBeUndefined()
    expect(result.rawOutput).toContain('"summary":"One bug."')
  })

  it('turns a long stretch of reasoning into a line every few hundred characters, and the rest when it completes', () => {
    const mapper = new CursorActivityMapper(WORKTREE)
    const delta = (text: string) => mapper.activities({ type: 'thinking', subtype: 'delta', text })
    expect(delta('Checking the loop bound. ')).toEqual([])
    const burst = delta('x'.repeat(480))
    expect(burst).toHaveLength(1)
    expect(burst[0]).toMatchObject({ kind: 'thinking' })
    expect(burst[0].text).toHaveLength(100)
    expect(burst[0].text.startsWith('Checking the loop bound. xxx')).toBe(true)
    expect(delta('  Done ')).toEqual([])
    expect(mapper.activities({ type: 'thinking', subtype: 'completed' })).toEqual([{ kind: 'thinking', text: 'Done' }])
    expect(mapper.activities({ type: 'thinking', subtype: 'completed' })).toEqual([])
  })

  it('ignores events without a tool payload', () => {
    expect(cursorActivities({ type: 'tool_call', subtype: 'started', tool_call: {} }, WORKTREE)).toEqual([])
    expect(cursorActivities({ type: 'tool_call', subtype: 'completed', tool_call: { readToolCall: { args: { path: 'x' } } } }, WORKTREE)).toEqual([])
    expect(cursorActivities({ type: 'thinking', subtype: 'delta', text: 'hm' }, WORKTREE)).toEqual([])
  })

  it('drops the workspace and any loadout message, which only Claude Code can use', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const loadout = { ...makeRequest().loadout, slashCommand: '/code-review {number}' }
    await makeRunner({ spawn }).review(request({ workspace: makeWorkspace(), loadout }).req)
    const prompt = calls[0].child.stdinText
    expect(prompt).not.toContain('Sibling repositories')
    expect(prompt).not.toContain('/Users/demo/Projects/storefront-web')
    expect(prompt).not.toContain('/code-review')
    expect(prompt).toContain('Respond with a single JSON object')
  })

  it('inlines the delta since the previous round on a follow-up', async () => {
    const { spawn, calls } = fakeSpawn(successScript)
    const { exec, calls: execCalls } = fakeExec((cmd, args) => (cmd === 'git' && args[2] === 'diff' ? { stdout: 'diff --git a/x b/x\n+delta-line', stderr: '', code: 0 } : undefined))
    const previousRound = makeRound({ id: 'round-1', index: 1, headSha: PREV_SHA, finishedAt: '2026-09-13T10:20:00.000Z' })
    await makeRunner({ spawn, exec }).review(request({ diff: '', previousRound }).req)
    expect(execCalls.find((c) => c.cmd === 'git')?.args).toEqual(['-C', WORKTREE, 'diff', `${PREV_SHA}..HEAD`])
    expect(calls[0].child.stdinText).toContain('+delta-line')
  })

  it('fails with the stderr tail when agent exits without a result, and still restores the config', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stderr.write('Error: not logged in\n')
      child.exit(1)
    })
    const { fs, ops } = fakeFs([CONFIG])
    await expect(makeRunner({ spawn, fs }).review(request().req)).rejects.toThrow('agent exited with code 1: Error: not logged in')
    expect(ops.at(-1)).toBe(`rename ${ASIDE} -> ${CONFIG}`)
  })

  it('fails when the result text holds no review', async () => {
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(resultLine({ result: 'I could not find the diff.' }))
      child.stderr.write('warning: slow\n')
      child.exit(0)
    })
    await expect(makeRunner({ spawn }).review(request().req)).rejects.toThrow(/Last stderr lines:\nwarning: slow/)
  })

  it('reports a cancelled review', async () => {
    const controller = new AbortController()
    const { spawn } = fakeSpawn((child) => {
      child.stdout.write(line({ type: 'system', subtype: 'init', model: 'Auto' }))
      controller.abort()
    })
    await expect(makeRunner({ spawn }).review(request({ signal: controller.signal }).req)).rejects.toThrow('Cancelled')
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AppSnapshot, Mission, ReviewRound } from '@core/domain'
import { SKILL_MESSAGE_EXAMPLE, defaultSettings } from '@core/loadouts'
import { DEMO_REVIEWS, seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    getSnapshot: vi.fn(async () => snapshot),
    refreshInbox: vi.fn(async () => snapshot),
    dispatch: vi.fn(async () => ({})),
    setFindingDecision: vi.fn(async () => {}),
    setFindingDecisions: vi.fn(async () => {}),
    previewComment: vi.fn(async () => '## Review\n\n- one finding'),
    postComment: vi.fn(async () => ({ url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-1' })),
    rerunMission: vi.fn(async () => {}),
    retryMission: vi.fn(async () => {}),
    closeMission: vi.fn(async () => {}),
    cancelMission: vi.fn(async () => {}),
    updateSettings: vi.fn(async (patch: object) => ({ ...snapshot.settings, ...patch })),
    discoverRepos: vi.fn(async () => []),
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
    demoSimulate: vi.fn(async () => {}),
    getActivity: vi.fn(async () => []),
    setRoundSummary: vi.fn(async () => {}),
    setAutoFollowUp: vi.fn(async () => {}),
    checkEnvironment: vi.fn(async () => ({ checkedAt: at, ok: true, items: [] })),
    relaunch: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))
vi.mock('@/screens/floor', () => ({ FloorScreen: () => <div>floor-stub</div> }))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { App } from './App'

const NOW = new Date('2026-09-13T12:00:00Z')
const at = NOW.toISOString()
const prs = seedPullRequests(NOW)

function round(prId: string, index: number, extra: Partial<ReviewRound> = {}): ReviewRound {
  const script = DEMO_REVIEWS[prId]
  return {
    id: `${prId}-r${index}`,
    index,
    headSha: prs.find((p) => p.id === prId)!.headSha,
    startedAt: at,
    finishedAt: at,
    findings: script.findings.map((f, i) => ({ ...f, id: `f${i}`, decision: 'pending' as const })),
    summary: script.summary,
    verdict: script.verdict,
    durationMs: 42_000,
    ...extra
  }
}

function mission(prIndex: number, state: Mission['state'], extra: Partial<Mission> = {}): Mission {
  const pr = prs[prIndex]
  return { id: `m-${pr.number}`, prId: pr.id, pr, loadoutId: 'blind', state, rounds: [], stale: false, autoPost: false, createdAt: at, updatedAt: at, timeline: [{ at, to: 'queued' }], ...extra }
}

const settings = defaultSettings()
const snapshot: AppSnapshot = {
  inbox: prs,
  missions: [
    mission(0, 'needs_you', { slotId: 'slot-1', rounds: [round(prs[0].id, 1)], stale: true }),
    mission(1, 'failed', { preferredSlotId: 'slot-2', error: 'git fetch failed: could not read from remote', rounds: [round(prs[1].id, 1)] }),
    mission(2, 'watching', { preferredSlotId: 'slot-2', rounds: [round(prs[2].id, 1, { postedAt: at, postedBody: '**Posted** body', postedCommentUrl: 'https://github.com/acme/mobile-app/pull/77#issuecomment-9', costUsd: 0.42 })] }),
    mission(3, 'reviewing', { slotId: 'slot-2', rounds: [round(prs[3].id, 1, { finishedAt: undefined, durationMs: undefined })] })
  ],
  slots: settings.slots,
  settings,
  localRepos: [{ fullName: 'acme/checkout-api', path: '/Users/demo/Projects/checkout-api', defaultBranch: 'main' }],
  lastPollAt: at,
  githubLogin: 'ritchey',
  version: '0.1.0-test'
}

beforeEach(() => {
  useAppStore.setState({ snapshot: structuredClone(snapshot), loading: false, screen: 'inbox', selectedMissionId: undefined, toasts: [] })
  vi.clearAllMocks()
})
afterEach(cleanup)

const nav = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Screens' })).getByRole('button', { name: new RegExp(`^${name}`) }))

describe('App shell', () => {
  it('shows the rail with counts, sync status and login', () => {
    render(<App />)
    expect(screen.getByText('Overlook')).toBeTruthy()
    expect(screen.getByLabelText('1 missions need you')).toBeTruthy()
    expect(screen.getByText(/^Synced/)).toBeTruthy()
    expect(screen.getByText('@ritchey')).toBeTruthy()
    expect(screen.getByText('DEMO')).toBeTruthy()
  })

  it('renders the triage pane for the first needs_you mission with a stale banner and findings', async () => {
    render(<App />)
    nav('Triage')
    expect(await screen.findByText(/The author pushed/)).toBeTruthy()
    const findings = screen.getByRole('list', { name: 'Findings' })
    expect(within(findings).getAllByRole('listitem')).toHaveLength(4)
    fireEvent.click(within(findings).getAllByRole('button', { name: 'Drop' })[0])
    expect(api.setFindingDecision).toHaveBeenCalledWith(expect.objectContaining({ missionId: 'm-412', findingId: 'f0', decision: 'dropped' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve blockers & majors' }))
    expect(api.setFindingDecisions).toHaveBeenCalledWith({ missionId: 'm-412', roundId: 'acme/checkout-api#412-r1', decision: 'approved', findingIds: ['f0', 'f1'] })
    expect(screen.getByRole('button', { name: /Post to GitHub/ }).hasAttribute('disabled')).toBe(true)
  })

  it('drops the remaining nits in one bulk call that carries the reason', async () => {
    render(<App />)
    nav('Triage')
    await screen.findByRole('list', { name: 'Findings' })
    fireEvent.click(screen.getByRole('button', { name: 'Drop all remaining nits' }))
    expect(api.setFindingDecisions).toHaveBeenCalledWith({
      missionId: 'm-412',
      roundId: 'acme/checkout-api#412-r1',
      decision: 'dropped',
      findingIds: ['f3'],
      dropReason: 'not_worth_it'
    })
  })

  it('posts after an inline confirmation once a decision exists', async () => {
    const snap = structuredClone(snapshot)
    snap.missions[0].rounds[0].findings[0].decision = 'approved'
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Triage')
    fireEvent.click(await screen.findByRole('button', { name: /Post to GitHub/ }))
    expect(screen.getByText('Post 1 finding?')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    })
    expect(api.postComment).toHaveBeenCalledWith('m-412')
    expect(await screen.findByText('Posted to #412')).toBeTruthy()
  })

  it('shows failed, watching and in-progress panes', async () => {
    render(<App />)
    nav('Triage')
    fireEvent.click(await screen.findByRole('button', { name: /#1203/ }))
    expect(screen.getByText('The mission failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.retryMission).toHaveBeenCalledWith('m-1203')
    fireEvent.click(screen.getByRole('button', { name: /^Recent/ }))
    fireEvent.click(screen.getByRole('button', { name: /#77/ }))
    expect(screen.getByText(/Watching for pushes/)).toBeTruthy()
    expect(screen.getByText('Posted')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /#58/ }))
    expect(screen.getByRole('log')).toBeTruthy()
  })

  it('lists every mission in the log and opens a drawer for non-triage states', () => {
    render(<App />)
    nav('Log')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(within(table).getByText('$0.42')).toBeTruthy()
    fireEvent.click(within(table).getByText('feat: retry webhook deliveries with exponential backoff').closest('tr')!)
    expect(screen.getByRole('complementary', { name: 'Mission details' })).toBeTruthy()
    fireEvent.click(within(table).getByText('fix(refunds): make refund creation idempotent per order').closest('tr')!)
    expect(useAppStore.getState().screen).toBe('triage')
    expect(useAppStore.getState().selectedMissionId).toBe('m-412')
  })

  it('shows which model and effort each round ran with in triage and the log', async () => {
    const snap = structuredClone(snapshot)
    Object.assign(snap.missions[0].rounds[0], { model: 'claude-opus-4-1', effort: 'high', costUsd: 0.12 })
    Object.assign(snap.missions[3].rounds[0], { model: 'opus', effort: 'default' })
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Triage')
    expect(await screen.findByText('claude-opus-4-1')).toBeTruthy()
    expect(screen.getByText('effort high')).toBeTruthy()
    expect(screen.getByText('Cost $0.12 · took 42s · claude-opus-4-1 (effort high)')).toBeTruthy()
    nav('Log')
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Model' })).toBeTruthy()
    expect(within(table).getByText('claude-opus-4-1')).toBeTruthy()
    expect(within(table).getByText('opus')).toBeTruthy()
    fireEvent.click(within(table).getByText('feat: retry webhook deliveries with exponential backoff').closest('tr')!)
    const rounds = within(screen.getByRole('complementary', { name: 'Mission details' })).getByRole('list', { name: 'Rounds' })
    expect(rounds.textContent).toContain('Round 1')
    expect(rounds.textContent).toContain('opus')
    expect(rounds.textContent).toContain('effort default')
  })

  it('saves settings on change', async () => {
    render(<App />)
    nav('Settings')
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
    expect(api.updateSettings).toHaveBeenCalledWith({ notifications: false })
    const poll = screen.getByLabelText('Poll interval') as HTMLInputElement
    fireEvent.change(poll, { target: { value: '300' } })
    fireEvent.blur(poll)
    expect(api.updateSettings).toHaveBeenCalledWith({ pollIntervalSec: 300 })
    const rounds = screen.getByLabelText('Automatic follow-up rounds') as HTMLInputElement
    fireEvent.change(rounds, { target: { value: '1.6' } })
    fireEvent.blur(rounds)
    expect(api.updateSettings).toHaveBeenCalledWith({ maxAutoRoundsPerMission: 2 })
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  it('saves a loadout message and clears it again on reset', async () => {
    const snap = structuredClone(snapshot)
    snap.settings.loadouts = snap.settings.loadouts.map((l) => (l.id === 'blind' ? { ...l, slashCommand: SKILL_MESSAGE_EXAMPLE } : l))
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Settings')
    const messages = screen.getAllByLabelText('Message (optional)') as HTMLInputElement[]
    expect(messages.map((c) => c.value)).toEqual([SKILL_MESSAGE_EXAMPLE, '', ''])
    // The caption shows the recipe with its placeholder literally.
    expect(screen.getAllByText(SKILL_MESSAGE_EXAMPLE)).toHaveLength(3)
    const resets = screen.getAllByRole('button', { name: 'Reset' }) as HTMLButtonElement[]
    expect(resets[0].disabled).toBe(false)
    expect(resets[1].disabled).toBe(true)
    fireEvent.click(resets[0])
    expect(api.updateSettings).toHaveBeenLastCalledWith({ loadouts: snapshot.settings.loadouts })
    act(() => useAppStore.setState({ snapshot: structuredClone(snapshot) }))
    expect(messages[0].value).toBe('')

    fireEvent.change(messages[1], { target: { value: '  Use the security-review skill on pull request #{number}  ' } })
    fireEvent.blur(messages[1])
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      loadouts: snapshot.settings.loadouts.map((l) => (l.id === 'security' ? { ...l, slashCommand: 'Use the security-review skill on pull request #{number}' } : l))
    })
  })

  it('edits the summary on blur, can restore the original, and shows the round details', async () => {
    const snap = structuredClone(snapshot)
    const r = snap.missions[0].rounds[0]
    r.originalSummary = 'The original summary.'
    r.rawOutput = '{ "summary": "raw" }'
    r.costUsd = 0.12
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Triage')
    const box = (await screen.findByLabelText('Summary')) as HTMLTextAreaElement
    expect(box.value).toBe(r.summary)
    fireEvent.change(box, { target: { value: 'Tighter summary.' } })
    fireEvent.blur(box)
    expect(api.setRoundSummary).toHaveBeenCalledWith({ missionId: 'm-412', roundId: 'acme/checkout-api#412-r1', summary: 'Tighter summary.' })
    expect(screen.getByText('edited')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }))
    expect(api.setRoundSummary).toHaveBeenLastCalledWith({ missionId: 'm-412', roundId: 'acme/checkout-api#412-r1', summary: 'The original summary.' })
    expect(screen.getByText('Cost $0.12 · took 42s')).toBeTruthy()
    const details = screen.getByText('Raw reviewer output').closest('details')!
    expect(screen.queryByText(/"summary"/)).toBeNull()
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByText(/"summary"/)).toBeTruthy()
  })

  it('keeps the summary read-only while posting', async () => {
    const snap = structuredClone(snapshot)
    snap.missions[0].state = 'posting'
    useAppStore.setState({ snapshot: snap, selectedMissionId: 'm-412' })
    render(<App />)
    nav('Triage')
    expect(await screen.findByText(snap.missions[0].rounds[0].summary)).toBeTruthy()
    expect(screen.queryByLabelText('Summary')).toBeNull()
  })

  it('toggles auto follow-up and re-runs with a chosen loadout while watching', async () => {
    const snap = structuredClone(snapshot)
    snap.missions[2].worktreePath = '/Users/demo/.overlook/worktrees/acme/mobile-app/pr-77'
    snap.settings.maxAutoRoundsPerMission = 3
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Triage')
    fireEvent.click(await screen.findByRole('button', { name: /^Recent/ }))
    fireEvent.click(screen.getByRole('button', { name: /#77/ }))
    expect(screen.getByText('0 of 3 automatic rounds used · $0.42 spent across 1 round')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Re-review automatically when the author pushes' }))
    expect(api.setAutoFollowUp).toHaveBeenCalledWith({ missionId: 'm-77', enabled: false })
    fireEvent.change(screen.getByRole('combobox', { name: 'Loadout for the next round' }), { target: { value: 'security' } })
    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }))
    expect(api.rerunMission).toHaveBeenCalledWith('m-77', 'security')
    fireEvent.click(screen.getByRole('button', { name: 'Open worktree' }))
    expect(api.openPath).toHaveBeenCalledWith('/Users/demo/.overlook/worktrees/acme/mobile-app/pr-77')
  })

  it('shows the environment check outside demo mode', async () => {
    const snap = structuredClone(snapshot)
    snap.settings.demoMode = false
    snap.environment = {
      checkedAt: at,
      ok: false,
      items: [
        { id: 'gh', label: 'GitHub CLI', ok: true, detail: 'gh 2.63.0 · ritchey' },
        { id: 'claude', label: 'Claude Code', ok: false, detail: 'claude: command not found' }
      ]
    }
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Environment check failed' }))
    expect(useAppStore.getState().screen).toBe('settings')
    const rows = within(screen.getByRole('list', { name: 'Environment checks' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('img', { name: 'ok' })).toBeTruthy()
    expect(within(rows[1]).getByRole('img', { name: 'failed' })).toBeTruthy()
    expect(within(rows[1]).getByText('claude: command not found')).toBeTruthy()
    expect(screen.getByText(/^Checked/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check environment' }))
    })
    expect(api.checkEnvironment).toHaveBeenCalled()
    act(() => useAppStore.setState({ snapshot: { ...snap, environment: undefined } }))
    expect(screen.getByRole('button', { name: 'Run environment check' })).toBeTruthy()
  })

  it('offers a restart after toggling demo mode, gated on running reviews', () => {
    render(<App />)
    nav('Settings')
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull()
    const flipped = { ...snapshot, settings: { ...snapshot.settings, demoMode: false } }
    act(() => useAppStore.setState({ snapshot: flipped }))
    expect(screen.getByRole('button', { name: 'Restart now' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Wait for running reviews to finish')).toBeTruthy()
    act(() => useAppStore.setState({ snapshot: { ...flipped, missions: flipped.missions.filter((m) => m.state === 'watching') } }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))
    expect(api.relaunch).toHaveBeenCalled()
  })

  it('surfaces a posting failure on the needs_you pane', async () => {
    const snap = structuredClone(snapshot)
    snap.missions[0].error = 'Posting failed: GitHub API: 502 Bad Gateway'
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Triage')
    expect(await screen.findByText('Posting failed: GitHub API: 502 Bad Gateway')).toBeTruthy()
  })

  it('keeps Enter on a control inside a log row from opening the row', () => {
    render(<App />)
    nav('Log')
    const button = screen.getByRole('button', { name: 'Open posted comment' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(useAppStore.getState().screen).toBe('log')
    expect(screen.queryByRole('complementary', { name: 'Mission details' })).toBeNull()
    fireEvent.keyDown(button.closest('tr')!, { key: 'Enter' })
    expect(useAppStore.getState().screen).toBe('triage')
    expect(useAppStore.getState().selectedMissionId).toBe('m-77')
  })

  it('reports a failed worktree removal on a closed mission', async () => {
    const snap = structuredClone(snapshot)
    const closed = snap.missions[2]
    closed.state = 'closed'
    closed.error = 'Worktree removal failed: fatal: worktree is locked'
    closed.worktreePath = '/Users/demo/.overlook/worktrees/acme/mobile-app/pr-77'
    closed.timeline.push({ at, from: 'watching', to: 'closed', note: 'PR merged' })
    useAppStore.setState({ snapshot: snap, selectedMissionId: 'm-77' })
    render(<App />)
    nav('Triage')
    expect(await screen.findByText('Worktree removal failed: fatal: worktree is locked')).toBeTruthy()
    expect(screen.queryByText(/has been removed/)).toBeNull()
  })

  it('lets Recent collapse again after selecting a mission inside it', async () => {
    render(<App />)
    nav('Triage')
    const recent = await screen.findByRole('button', { name: /^Recent/ })
    fireEvent.click(recent)
    fireEvent.click(screen.getByRole('button', { name: /#77/ }))
    expect(screen.getByText(/Watching for pushes/)).toBeTruthy()
    fireEvent.click(recent)
    expect(recent.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /#77/ })).toBeNull()
  })

  it('offers repos known only through a path override for auto-post', () => {
    const snap = structuredClone(snapshot)
    snap.settings.repoPaths = { 'acme/legacy-api': '/Users/demo/Projects/legacy-api' }
    useAppStore.setState({ snapshot: snap })
    render(<App />)
    nav('Settings')
    expect(screen.getByRole('checkbox', { name: 'acme/legacy-api' })).toBeTruthy()
  })
})

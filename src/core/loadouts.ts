import type { Loadout, Settings, Slot } from './domain'

/**
 * Loadout messages the app itself once shipped and later withdrew. A bare
 * slash command runs as a host command outside the conversation and reports
 * through the interactive UI, so a headless run gets no findings payload;
 * these are cleared when settings load, since the user never typed them.
 */
export const RETIRED_SLASH_COMMANDS: readonly string[] = ['/code-review {number} high']

/** A loadout message that runs a skill inside the conversation; `{number}` is the PR number. */
export const SKILL_MESSAGE_EXAMPLE =
  'Use the code-review skill at level high on pull request #{number}, then return the review as the structured output.'

export const BUILT_IN_LOADOUTS: Loadout[] = [
  {
    id: 'blind',
    name: 'Blind review',
    tagline: 'No focus list. Read everything, report what matters.',
    builtIn: true,
    prompt: `Review this pull request the way a careful senior engineer on the team would, with no focus list.
Read the full diff, then open the surrounding code the diff touches so you understand how the change is used.
Prioritise, in order: behaviour regressions and correctness bugs, data loss or security exposure, broken or missing tests for changed behaviour, then maintainability.
Verify every claim by reading code. Do not report a bug you have not traced to a concrete input and outcome.
Keep style remarks to a minimum and mark them as nits. One finding per distinct problem.`
  },
  {
    id: 'security',
    name: 'Security pass',
    tagline: 'Auth, injection, secrets, data exposure, races.',
    builtIn: true,
    prompt: `Review this pull request for security and safety only.
Look for: missing or weakened authentication and authorisation checks, injection (SQL, shell, template, path), secrets or tokens in code or logs, sensitive data returned or logged, unsafe deserialisation, SSRF, CSRF, insecure defaults, race conditions on money or inventory, and dependency changes with known risk.
For each finding trace the untrusted input to the dangerous sink and state the impact. Skip anything that is not a security concern; if the change is clean, say so with a short summary and return no findings.`
  },
  {
    id: 'product',
    name: 'Product eye',
    tagline: 'User flows, edge cases, and decisions a human must make.',
    builtIn: true,
    prompt: `Review this pull request from the product and user-experience angle.
Trace each user-facing flow the change affects. Look for: edge cases in real usage (empty, partial, offline, retries, concurrent users), confusing copy or naming, API or event shapes that will be hard to change later, behaviour that silently differs from what the PR title promises, and anything that is really a product decision rather than an engineering one.
Tag product decisions with category "product" and phrase them as a question the team should answer, not as a defect.`
  }
]

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'slot-1', name: 'Vhagar', color: '#f5b544' },
  { id: 'slot-2', name: 'Nova', color: '#4fd1c5' }
]

export function defaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    projectsRoots: ['~/Projects'],
    repoPaths: {},
    pollIntervalSec: 120,
    slots: DEFAULT_SLOTS.map((s) => ({ ...s })),
    loadouts: BUILT_IN_LOADOUTS.map((l) => ({ ...l })),
    defaultLoadoutId: 'blind',
    claudePath: 'claude',
    claudeModel: 'opus',
    claudeEffort: undefined,
    claudeFallbackModel: undefined,
    maxBudgetUsdPerReview: 3,
    worktreeRoot: '~/.overlook/worktrees',
    autoPostRepos: [],
    maxAutoRoundsPerMission: 0,
    prepareCommands: {},
    linkNodeModules: true,
    notifications: true,
    demoMode: true,
    signature: '{loadout} · Reviewed by {character} · {approval}',
    includeMine: true,
    inactiveRepos: [],
    maxPrAgeDays: 30,
    workspaces: [],
    ...overrides
  }
}

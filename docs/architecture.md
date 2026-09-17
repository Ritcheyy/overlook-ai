# Architecture

Overlook is an Electron app with one deliberate split: an engine that knows nothing about Electron, Node or the browser, and thin shells around it.

## Processes

```
┌──────────────────────────── Overlook.app ────────────────────────────┐
│  main process (Node)                      renderer (Chromium)        │
│  ┌──────────────────────┐   IPC bridge    ┌────────────────────────┐ │
│  │ engine (src/core)    │◀──────────────▶│ React UI               │ │
│  │  scheduler, poller   │  preload:       │  floor · inbox         │ │
│  │  review prompt/parse │  window.bridge  │  triage · log · settings│ │
│  └──────────┬───────────┘                 └────────────────────────┘ │
│             │ ports                                                  │
│  ┌──────────▼───────────┐                                            │
│  │ adapters (src/main)  │  gh CLI · git worktrees · claude -p        │
│  │                      │  repo discovery · JSON store · notifier    │
│  └──────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────┘
```

- **Main** owns everything with side effects: polling GitHub, creating worktrees, spawning Claude, persisting state, OS notifications, the dock badge.
- **Renderer** only renders snapshots and calls the typed API. It never touches git, GitHub or Claude.
- **Preload** exposes `window.bridge` with `invoke(method, ...args)` and `on(event, cb)`; `src/core/ipc-contract.ts` is the single definition of both sides.

## The engine (`src/core`)

Browser-safe TypeScript. It is composed twice: by the main process with real adapters, and by the browser (`pnpm dev:web`, the Playwright web project, demo mode) with fakes. Both call `createEngine` in `src/core/engine/api-server.ts`.

- **Ports** (`ports.ts`): `GitHubPort`, `WorktreePort`, `ReposPort`, `RunnerPort`, `StorePort`, `NotifierPort`, `Clock`. Every port has a fake in `src/core/mocks`.
- **Scheduler** (`engine/scheduler.ts`): the only place mission state changes. One `transition()` function appends to the mission timeline, keeps slot links consistent, and emits a snapshot. `runMission` drives prepare → review → needs_you/posting; `postComment` builds and posts the comment; `recover()` repairs state after a restart.
- **Poller** (`engine/poller.ts`): merges the review-requested and authored listings, applies the active-repo and age filters, re-fetches every active mission's PR, and reconciles: merged or closed PRs close the mission, a new head sha re-queues a watching mission (or marks it stale when automatic follow-up is off or capped), a push during triage marks it stale.
- **Review** (`review/`): `prompt.ts` builds the prompt (PR facts, loadout, workspace section, briefing instructions, output shape); `schema.ts` is the JSON schema passed to the CLI and the zod normaliser; `parse.ts` turns the CLI's result envelope into a `ReviewResult` and, in strict mode, fails when no findings payload exists; `report-findings.ts` recovers findings from a skill's `ReportFindings` call.
- **Comment builder** (`comment-builder.ts`): approved findings only, ordered by severity, linked to `file#line` at the reviewed sha, with the signature template rendered.
- **Workspaces** (`engine/workspaces.ts`): merges detected containers into settings and builds the `WorkspaceContext` a review gets (siblings, your open PRs there, notes).

## Mission lifecycle

```
queued ──▶ preparing ──▶ reviewing ──▶ needs_you ──▶ posting ──▶ watching
              │              │             ▲                        │
              ▼              ▼             │ rerun        new push  │
            failed         failed          └────────────────────────┘
any ──▶ closed   (PR merged/closed, or closed by the user)
```

A mission holds a slot (a character) from `preparing` through `posting`. `watching` keeps the worktree but frees the slot, so two reviews can always run. A push on a watching mission re-queues it at the front, preferring its previous character, for a delta review; past the automatic-follow-up cap it only marks the mission stale.

## A review, step by step

1. `WorktreePort.prepare` fetches `refs/pull/<n>/head` and the base branch into the local clone, adds or updates a detached worktree at `<worktreeRoot>/<owner>/<repo>/pr-<n>`, links `node_modules`, runs the optional prepare command.
2. The scheduler builds the `ReviewRequest`: mission, round, loadout, diff (full PR diff on round one, empty on follow-ups so the runner computes the delta), previous round, settings, workspace context.
3. `ClaudeCliRunner` spawns `claude -p --output-format stream-json --json-schema … --max-budget-usd … --allowedTools … --setting-sources user --strict-mcp-config`, writes the prompt to stdin, maps tool-use events to activity for the floor, captures the resolved model, and parses the final result strictly.
4. Findings get ids and a decision (`pending`, or `approved` for auto-post). The round stores summary, verdict, briefing, model, effort, cost, duration and the last activity lines.
5. `needs_you` waits for triage, or auto-post goes straight to `posting`. Posting uses `gh pr comment --body-file -`.

## State and persistence

`PersistedState` is `{ missions, settings, inbox, lastPollAt }`, written as JSON by `JsonFileStore` (atomic rename, corrupt files quarantined) to Electron's user-data folder, debounced after every change and flushed on quit. Activity beyond the per-round tail is in memory only. Settings from older versions are back-filled by `sanitizeSettings`.

## Renderer

`src/renderer/src/state/store.ts` holds the latest snapshot, per-mission activity, toasts and navigation. Screens call `api` from `src/renderer/src/lib/api.ts`, which is the bridge inside Electron and the in-process demo engine in a browser. The floor (`screens/floor`) is React Three Fiber with procedural geometry only; `animation.ts` is the pure mapping from mission state and last activity to pose, colour and screen content, and is unit-tested without WebGL.

## Testing

- **Vitest** covers the engine end to end with fakes (lifecycle, follow-ups, recovery, filters, workspaces), the adapters with injected `exec`/`spawn` (git against a real temp repository), and the UI with jsdom.
- **Playwright web** drives the browser build on the demo engine through inbox → floor → triage → post → follow-up → merge, and regenerates the screenshots.
- **Playwright electron** launches the packaged main process in demo mode with a fresh profile: startup, persistence across restart, IPC error paths.

# Contributing to Overlook

Overlook is a macOS desktop app that reviews GitHub pull requests with Claude Code. This guide covers getting a working checkout, the conventions the code follows, and how changes are verified.

## Setup

Requirements: Node 22, pnpm 11, macOS (the packaging and Electron end-to-end tests are macOS-only; the engine and web tests run anywhere).

```bash
pnpm install
pnpm dev          # Electron with hot reload
pnpm dev:web      # the UI alone in a browser, on the in-process demo engine
```

Demo mode is on by default. A fake GitHub and a fake reviewer drive the whole app, so nothing needs a login or spends tokens. Real mode needs `gh` logged in and the `claude` CLI installed; see the README.

If your shell exports `ELECTRON_RUN_AS_NODE` (some agent harnesses do), unset it before `pnpm dev` or `open`, or Electron starts as plain Node and exits silently.

## Verify before you open a pull request

```bash
pnpm typecheck        # main + renderer TypeScript projects
pnpm test             # vitest: engine, adapters, UI
pnpm build:web && pnpm build
pnpm e2e:web          # playwright against the browser build (demo engine)
pnpm e2e:electron     # playwright driving the packaged main process in demo mode
```

Run the two Playwright projects one after the other; they share `test-results/`. The web project needs Playwright's Chromium once: `npx playwright install chromium --only-shell`. Screenshots land in `e2e/screenshots/` and are ignored by git.

Tests never call the real `claude` CLI or GitHub. Adapters take an injected `exec`/`spawn` and are tested with fakes; the git worktree adapter is tested against real git in a temp directory.

## Where things live

- `src/core` — browser-safe engine. Contracts at the root (`domain.ts`, `ports.ts`, `ipc-contract.ts`, `loadouts.ts`, `comment-builder.ts`); `engine/` holds the scheduler, poller, API server, workspaces and path helpers; `review/` the prompt, schema and parser; `mocks/` a fake for every port; `demo/` the seed data and the in-browser engine. No Node imports.
- `src/main` — Electron main process: composition root, IPC, real adapters (`gh` CLI, git worktrees, repo discovery, Claude CLI runner, JSON store), environment checks.
- `src/preload` — the typed bridge exposed to the renderer.
- `src/renderer` — React UI: `screens/` (floor, inbox, triage, log, settings), `components/ui/` (generic controls: Button, Chip, Select…), `components/app/` (app-specific pieces: Rail, StateChip, Timeline…), `state/` (the store), `lib/` (the API client and formatting).
- `resources/` — the icon source (`icon.svg`, rendered to `icon.png`); `build/` — the `.icns` and PNG electron-builder consumes. Edit the SVG and re-render; do not edit `build/` by hand.
- `docs/` — architecture and operations.

`docs/architecture.md` explains how these fit together.

## Conventions

- TypeScript strict. No `any` unless unavoidable.
- 2-space indent, no semicolons, single quotes. There is no linter; match the surrounding file.
- Comments explain why, not what. No section banners, no references to a task or a conversation.
- Contract files (`src/core/domain.ts`, `src/core/ports.ts`, `src/core/ipc-contract.ts`) change additively: new optional fields, new union members, new port methods with mock implementations. Persisted state from older versions must still load; `sanitizeSettings` in `src/core/engine/api-server.ts` is where defaults are back-filled.
- Every port has a fake in `src/core/mocks`. Add to the fake whenever you extend the port.
- Colours come from the tokens in `src/renderer/src/styles/globals.css`; the floor reads the same values through `TOKENS` in `src/renderer/src/screens/floor/animation.ts`.
- No network assets in the renderer: Electron's content security policy blocks them, and the floor must work offline.

## Adding things

- **A loadout** (review style): add it to `BUILT_IN_LOADOUTS` in `src/core/loadouts.ts`. The prompt text is appended to the generated review prompt.
- **A finding category or severity**: extend the union in `src/core/domain.ts`, the lists in `src/core/review/schema.ts`, the colour map in the triage `FindingCard`, and the comment builder's ordering if needed.
- **A setting**: add it to `Settings` and `defaultSettings`, back-fill it in `sanitizeSettings`, expose it in the settings screen, and cover the persistence round-trip in `src/core/engine/api-server.test.ts`.
- **A new git host**: implement `GitHubPort` for it in `src/main/adapters`, plus a fake in `src/core/mocks`. The engine never talks to a host directly.

## Commits and pull requests

One summary line per commit, no trailers. Keep pull requests focused; describe what changed and how you verified it. Screenshots for UI changes help, and the web end-to-end suite regenerates them for you.

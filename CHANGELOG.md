# Changelog

## 0.1.0

First working version.

- Inbox of GitHub review requests (and your own PRs) polled with the `gh` CLI, with per-repo on/off toggles and an age cut-off.
- Two review characters on a 3D floor whose animation follows the real mission state; queued PRs on a shelf, watched PRs on a corkboard, unreviewed pushes marked.
- Reviews run by Claude Code (`claude -p`) in an isolated git worktree with a read-only tool allow-list, structured output, a per-review budget, a chosen model and effort, and a fallback model.
- Triage: approve or drop each finding with a reason, edit the summary, preview, and post one comment; per-repo auto-post.
- Briefing: every review returns a short plain-language explanation of the PR for the reviewer, never posted.
- Follow-up rounds on pushes review only the delta; automatic follow-ups are capped and can be switched off per mission.
- Workspaces: a container folder holding several repos gives reviews read access to sibling repos, the container's notes, and your open PRs in siblings; findings can point at a related PR.
- Log with per-round model, effort, cost, duration and the posted comment.
- Environment check for `gh`, `claude`, `git` and the worktree root; login-shell PATH import for Finder launches.
- Demo mode with a fake GitHub and a scripted reviewer; web and Electron end-to-end suites.
- Packaging into a signed local `.app` with `pnpm release`.

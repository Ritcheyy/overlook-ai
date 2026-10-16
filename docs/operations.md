# Operations

Running Overlook for real, packaging it, and what to do when something looks wrong.

## Real mode checklist

1. `gh auth status` shows you logged in to github.com.
2. `claude --version` works in your terminal (or `agent --version` for Cursor; see below). If it is installed by nvm or under a path only your `.zshrc` knows, set the absolute path in Settings > Engine.
3. Your repositories are checked out under a folder listed in Settings > Repositories > Project roots. Discovery scans two levels deep.
4. Settings > General: turn Demo mode off and press Restart now.
5. Settings > Engine: press Check environment. Every row must be green.
6. Settings > Repositories: switch off the repos you do not review. Inactive repos are hidden and never fetched in detail.
7. Start a review of one small PR from the Inbox and read the result in Triage before turning on auto-post for a repo.

## Reviewing with Cursor instead of Claude Code

Settings > Engine chooses the CLI that runs reviews. For Cursor:

1. Install the CLI with `curl https://cursor.com/install -fsS | bash`, then run `agent login`. `agent models` lists the names your account can use; the free tier works with the Auto choice.
2. Settings > Engine: pick Cursor, keep the path as `agent` or set the absolute one, set a model name or leave it empty for Auto, and press Check environment. The check also confirms the login.

What differs from Claude Code:

- The run is kept read-only through a `.cursor/cli.json` the app writes into the worktree for its duration: files in the workspace, `git diff`, `git log`, `git show`, `git blame`, `git status`, `gh pr diff` and `gh pr view`. Everything else, writes included, is rejected. The PR branch's own `.cursor` folder is renamed to `.cursor.overlook-aside` while the review runs, so its hooks, rules and MCP config never load, and is put back afterwards.
- Cursor reports no cost, so rounds show none and the per-review budget does not apply. Effort and the fallback model are Claude Code settings and stay hidden.
- The reviewer only sees the worktree. Workspace sibling repos and notes are left out of the prompt, and a review type with a Message (a Claude Code skill) runs as the plain generated prompt.
- The model recorded on a round is the name Cursor announces, such as `Auto`.

## Packaging and updating

```bash
pnpm release    # build, package to dist/mac-arm64/Overlook.app, install to /Applications, ad-hoc sign
```

There is no auto-updater; run `pnpm release` again after pulling changes. Settings and history live in `~/Library/Application Support/Overlook` and survive reinstalls. The install script uses `ditto` (Node's copy breaks the framework symlinks) and signs the bundle ad hoc (an unsigned bundle is refused by LaunchServices without any message).

## How a Finder-launched app finds your tools

Finder gives an app no `SHELL` and a bare `PATH`. On start the app asks Directory Services for your login shell, runs it as a login shell to read its `PATH`, and appends `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` when they exist. Entries added only in `.zshrc` are still invisible; set absolute paths in Settings for those.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Rail shows a poll error | `gh` not found or not logged in | Check environment in Settings; `gh auth login` |
| A review fails with "No local checkout found" | The repo is not under a project root | Add the root or a path override in Settings > Repositories |
| A review fails with "Claude finished without a findings payload" | A slash command in the review type's Message field ran outside the conversation | Clear the field; to use the code-review skill, use the recipe under "Review types and skills" below |
| A review fails with `error_max_budget_usd` | The review hit the per-review cap and returned nothing | Raise Max budget per review, or use Review options to give that one run more |
| A review fails with "Checking out … failed" | Git could not check out the new head in the existing worktree, often a stale `index.lock` | Fix the cause in that worktree, then Retry; the app leaves the folder as it is |
| A push did not start a follow-up | Follow-ups need the author's reply to the posted round as well, within the round cap | Review the delta by hand, or raise Automatic follow-up rounds |
| Review found nothing in a sibling repo it should have | The workspace is off, or notes are off | Settings > Repositories > Workspaces |
| App opened from a terminal exits at once | `ELECTRON_RUN_AS_NODE` is set in that shell | `unset ELECTRON_RUN_AS_NODE` |
| Helper processes crash after install | The bundle was copied with a tool that rewrote symlinks | Reinstall with `pnpm app:install` |
| Dock badge is stale | Badge tracks reviews waiting for your decisions | Open Triage; closing or posting clears it |

## Follow-ups and replies

Every comment that posts findings numbers them and ends with the reply request (Settings > General) and a collapsed reply template: a table with one row per finding for the author to fill with fixed, won't fix or disagree. On each poll the app reads the watched PR's conversation and keeps the PR author's comments that came after the last posted round, ignoring the app's own comments by id and everyone else's by login, so a bot commenting on every push starts nothing.

- **Reply and push:** a follow-up round starts on its own if Automatic follow-up rounds allows one more, and is handed the reply as the author's claims to check.
- **Push, no reply:** the PR is marked with a new push and waits.
- **Reply, no push:** the PR is marked replied and a notification says no follow-up started, since a reply without code usually needs your reading.

Review the delta by hand from the status line at any time; a manual round is also given any replies.

## Notifications

Every notification carries its next step. The macOS notification shows one button when you hover over it: Review now on a new review request, Open triage when findings are ready, Review the delta or Review again after a push or a reply, Retry after a failure. macOS only reveals notification buttons on hover, and folds two or more into an Options menu, which is why the notification carries one. The in-app toast at the bottom right shows every action, Ignore included.

The packaged app asks macOS for the persistent alert style so a notification waits until you deal with it; System Settings > Notifications > Overlook can change that.

A new PR is announced the first time it appears in the Inbox from someone else. Your own PRs and drafts stay quiet; a draft is announced when it is marked ready. More than five new PRs in one poll become a single summary, as after a week away or switching a repo on. The first poll after a fresh install announces nothing.

Ignore hides a PR from the Inbox until its author pushes again; the Inbox's Ignored filter lists them, with Show again on each.

## Review types and skills

Every built-in review type sends the app's generated prompt (PR facts, environment rules, the review type's instructions, the output shape) as the message. A review type can instead carry a **Message** (Settings > Review types) that is sent as the user message; the generated prompt then goes through `--append-system-prompt` behind a headless preamble that forbids posting, `--comment`, `--fix` and edits. `{number}` is replaced by the PR number. Use it to run a Claude Code skill by name inside the conversation:

```
Use the code-review skill at level high on pull request #{number}, then return the review as the structured output.
```

Do not put a bare slash command such as `/code-review {number} high` there. Claude Code runs it as a host command outside the conversation and reports through the interactive findings panel (a `ReportFindings` tool call) instead of the structured output. Headless, the app recovers findings from that call on a best-effort basis (title, body, file, line, a category, and a severity from the skill's CONFIRMED/PLAUSIBLE verdicts); when neither a structured output nor that call is present the mission fails with a clear error rather than posting an empty review.

## Signature placeholders

The comment signature in Settings > General is a template. Placeholders: `{type}` (review type), `{reviewer}` (the reviewer that ran it), `{login}` (your GitHub login), `{approval}` ("Findings approved by <login>" or "Posted automatically"), `{round}` (round number), `{sha}` (short reviewed commit). The older `{loadout}` and `{character}` still work. An empty template posts no signature.

## Where things are on disk

- State: `~/Library/Application Support/Overlook/state.json`
- Worktrees: `~/.overlook/worktrees/<owner>/<repo>/pr-<n>` (also listed by `git worktree list` in the repo)
- Workspace notes read by reviews: `~/.claude/projects/<encoded container path>/memory/`

Deleting `state.json` starts the app fresh. Worktrees are removed when a review closes; leftovers can be removed with `git worktree remove --force <path>` in the repo.

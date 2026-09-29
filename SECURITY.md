# Security

Overlook runs on your machine and spends your own Claude and GitHub credentials. This page says what it does with them and what it will not do.

## What the app touches

- **GitHub**, only through the `gh` CLI you are already logged in with. The app never stores a token. It reads pull requests, diffs and review requests, and posts one comment per review when you post it.
- **Your repositories**, read-only, through git worktrees under `~/.overlook/worktrees`. The main checkout is never modified; a worktree is a detached checkout of the PR head registered against your local clone.
- **Claude Code**, spawned as `claude -p` inside the worktree with a read-only tool allow-list: `Read`, `Grep`, `Glob`, `LS`, and `git diff`, `git log`, `git show`, `git blame`, `git status`, plus `gh pr view`, `gh pr diff` and `gh pr list`. In a workspace, read-only git commands inside sibling checkouts are added. No file writes, no arbitrary shell.
- **Project settings on the PR branch are ignored.** Reviews run with `--setting-sources user --strict-mcp-config`, so a pull request cannot hand the reviewer hooks, permission grants or MCP servers through its `.claude/` folder. The repository's `CLAUDE.md` still loads, which is intended.
- **Workspace notes** (Claude Code's memory for a container folder) are sent to Claude as part of the review prompt when the workspace's notes toggle is on. They are read-only to the reviewer and never posted to GitHub. Turn the toggle off for a workspace whose notes hold anything you would not paste into a prompt.

## Things to know before relying on it

- **Prepare commands run branch code.** A per-repo prepare command (Settings > Repositories) runs inside the worktree with your shell, so a hostile pull request that edits `package.json` scripts could execute code if your prepare command runs an install. Only set prepare commands for repositories you trust.
- **A pull request can edit `CLAUDE.md`.** The reviewer reads the PR branch's version, so a PR can influence its own review instructions. The read-only tool allow-list still bounds what it can do.
- **Posted comments carry your identity.** They are posted through your `gh` login and end with the signature template from Settings, which names the reviewer and, for auto-posted reviews, says "Posted automatically".
- **Replies are untrusted input.** Follow-up reviews are handed the PR author's replies inside a fenced block marked as claims to check, not instructions; the read-only tool allow-list applies as always. Only the PR author's comments count, and each is trimmed in size.
- **Budget.** Every review runs under `--max-budget-usd`. On a subscription this caps work per review, not money; nothing stops you from dispatching many reviews.
- **State on disk.** Reviews, findings, briefings, the author's replies and posted comments are kept in `~/Library/Application Support/Overlook/state.json` in plain JSON.

## Reporting a vulnerability

Open a private security advisory at https://github.com/Ritcheyy/overlook-ai/security/advisories, or email the maintainer listed in `package.json`. Please include the version, the steps to reproduce, and what a malicious pull request or repository could achieve.

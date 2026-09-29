# Changelog

## 0.2.0

- Every pull request opens its details in the app, from the Inbox, the floor, the Log and notifications; GitHub is a labelled icon, never the default click. Unreviewed PRs open the same screen with the review options.
- The details screen shows the author, branches, age, size, labels and GitHub's review decision; one status line with the next action; a tab per round with the briefing, verdict, compact findings and the posted comment; review facts, the PR description and a history grouped by round beside it.
- Review options for a single run: review type, model, effort, budget and auto-post, from the arrow next to Review and Re-run.
- Follow-ups start on the author's reply: posted findings are numbered, comments end with a reply request and a disposition template, and an automatic follow-up needs a reply and a push. Replies are matched by comment, not login, and handed to the reviewer as claims to verify. A reply without a push is flagged.
- Verdict, new-push and reply markers on the Inbox, the Triage list and the Log; closed reviews move to the Log, whose rows all open a side panel.
- Plain terms in the UI: review, review type and reviewer.
- Finding file links open VS Code or Cursor at the line in the worktree, with GitHub beside them.
- A failed checkout in a healthy worktree is reported instead of deleting the folder.
- Cards, desks and labels on the 3D floor take clicks again; a card's own number label used to swallow them.
- The "new push" flag clears when a review closes; the corkboard shows pushes and replies first and names the PR on each tag; a failed desk prints its error once; the Inbox filters add up; the Log sorts by latest activity; Settings shows saves and adjusted values beside the field; the auto-post list only offers active repos; the rail runs the environment check itself.

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

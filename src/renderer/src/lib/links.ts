import type { FileLinkTarget, Mission, ReviewRound } from '@core/domain'

/** `owner/name#123` -> the pull request page. */
export function relatedPrUrl(ref: string): string {
  const hash = ref.lastIndexOf('#')
  return `https://github.com/${ref.slice(0, hash)}/pull/${ref.slice(hash + 1)}`
}

export function githubBlobUrl(mission: Pick<Mission, 'pr'>, round: Pick<ReviewRound, 'headSha'>, file: string, line?: number): string {
  const path = file.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
  const base = `https://github.com/${mission.pr.repo.fullName}/blob/${round.headSha}/${path}`
  return line ? `${base}#L${line}` : base
}

const EDITOR_SCHEMES: Partial<Record<FileLinkTarget, string>> = { vscode: 'vscode', cursor: 'cursor' }
export const EDITOR_LABELS: Record<FileLinkTarget, string> = { vscode: 'VS Code', cursor: 'Cursor', github: 'GitHub' }

/**
 * `vscode://file/<worktree>/<file>:<line>` for a finding, or undefined when
 * the editor is off, the worktree is gone, or the path would leave the
 * worktree (paths come from the reviewer's output).
 */
export function editorFileUrl(target: FileLinkTarget, worktreePath: string | undefined, file: string, line?: number): string | undefined {
  const scheme = EDITOR_SCHEMES[target]
  if (!scheme || !worktreePath) return undefined
  const parts = file.split('/').filter((p) => p && p !== '.')
  if (parts.length === 0 || parts.some((p) => p === '..')) return undefined
  const root = worktreePath.replace(/\/+$/, '')
  const path = [...root.split('/'), ...parts].map((seg, i) => (i === 0 && seg === '' ? '' : encodeURIComponent(seg))).join('/')
  return `${scheme}://file${path}${line ? `:${line}` : ''}`
}

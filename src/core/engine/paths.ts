/**
 * Browser-safe path helpers. The engine runs in the renderer in demo mode, so
 * it cannot use node:path; every join is '/'-based on purpose.
 */

/** Joins segments with '/', collapsing repeated separators and dropping a trailing one. */
export function joinPath(...parts: string[]): string {
  const joined = parts.filter((p) => p.length > 0).join('/').replace(/\/{2,}/g, '/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined
}

/** Replaces a leading `~` (alone or as `~/…`) with `homeDir`. Anything else is returned untouched. */
export function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return joinPath(homeDir, path.slice(2))
  return path
}

export interface WorktreeTarget {
  number: number
  repo: { owner: string; name: string }
}

/** `<worktreeRoot>/<owner>/<name>/pr-<number>` with `~` expanded. */
export function worktreePathFor(worktreeRoot: string, pr: WorktreeTarget, homeDir: string): string {
  return joinPath(expandHome(worktreeRoot, homeDir), pr.repo.owner, pr.repo.name, `pr-${pr.number}`)
}

/** Splits `owner/name#123` into its parts; returns undefined when the id is malformed. */
export function parsePrId(prId: string): { fullName: string; number: number } | undefined {
  const hash = prId.lastIndexOf('#')
  if (hash <= 0) return undefined
  const fullName = prId.slice(0, hash)
  const number = Number(prId.slice(hash + 1))
  if (!fullName.includes('/') || !Number.isInteger(number) || number <= 0) return undefined
  return { fullName, number }
}

import { describe, expect, it } from 'vitest'
import { editorFileUrl, githubBlobUrl, relatedPrUrl } from './links'

describe('editorFileUrl', () => {
  it('points the editor at the file and line inside the worktree', () => {
    expect(editorFileUrl('vscode', '/Users/me/.overlook/worktrees/acme/api/pr-7', 'src/app.ts', 12)).toBe('vscode://file/Users/me/.overlook/worktrees/acme/api/pr-7/src/app.ts:12')
    expect(editorFileUrl('cursor', '/w/pr-7/', 'docs/my file.md')).toBe('cursor://file/w/pr-7/docs/my%20file.md')
  })

  it('refuses paths that leave the worktree, and has nothing to open without a worktree or an editor', () => {
    expect(editorFileUrl('vscode', '/w/pr-7', '../../.ssh/id_rsa', 1)).toBeUndefined()
    expect(editorFileUrl('vscode', undefined, 'src/app.ts', 1)).toBeUndefined()
    expect(editorFileUrl('github', '/w/pr-7', 'src/app.ts', 1)).toBeUndefined()
  })
})

describe('github links', () => {
  it('builds blob and pull request URLs', () => {
    const mission = { pr: { repo: { fullName: 'acme/api' } } } as never
    expect(githubBlobUrl(mission, { headSha: 'abc' }, '/src/a b.ts', 3)).toBe('https://github.com/acme/api/blob/abc/src/a%20b.ts#L3')
    expect(relatedPrUrl('acme/web#12')).toBe('https://github.com/acme/web/pull/12')
  })
})

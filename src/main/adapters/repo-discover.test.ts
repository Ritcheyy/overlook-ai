import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NOTES_FILE_CHARS, NOTES_TOTAL_CHARS, RepoDiscovery, encodeProjectPath, expandHome, linkedNoteFiles, parseGitHubRemote, parseOriginUrl } from './repo-discover'

let home: string

beforeEach(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'prr-home-'))
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

async function repo(path: string, originUrl: string, opts: { originHead?: string; packedMain?: boolean } = {}): Promise<void> {
  const gitDir = join(path, '.git')
  await fs.mkdir(gitDir, { recursive: true })
  await fs.writeFile(
    join(gitDir, 'config'),
    `[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = ${originUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`
  )
  if (opts.originHead) {
    await fs.mkdir(join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })
    await fs.writeFile(join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'), `ref: refs/remotes/origin/${opts.originHead}\n`)
  }
  if (opts.packedMain) {
    await fs.writeFile(join(gitDir, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted \n${'a'.repeat(40)} refs/heads/main\n${'b'.repeat(40)} refs/remotes/origin/main\n`)
  }
}

describe('parseGitHubRemote', () => {
  it.each([
    ['git@github.com:acme/checkout-api.git', 'acme/checkout-api'],
    ['git@github.com:nestedco/nested-api', 'nestedco/nested-api'],
    ['https://github.com/acme/checkout-api.git', 'acme/checkout-api'],
    ['https://github.com/acme/checkout-api', 'acme/checkout-api'],
    ['https://github.com/acme/checkout-api/', 'acme/checkout-api'],
    ['https://ritchey@github.com/acme/checkout-api.git', 'acme/checkout-api'],
    ['ssh://git@github.com/acme/checkout-api.git', 'acme/checkout-api'],
    ['ssh://git@github.com:22/acme/checkout-api.git', 'acme/checkout-api'],
    ['ssh://git@ssh.github.com:443/acme/checkout-api.git', 'acme/checkout-api'],
    ['git://github.com/acme/checkout-api.git', 'acme/checkout-api'],
    ['git@github.com-work:acme/checkout-api.git', 'acme/checkout-api'],
    ['GIT@GITHUB.COM:Acme/Checkout-API.git', 'Acme/Checkout-API']
  ])('parses %s', (url, fullName) => {
    expect(parseGitHubRemote(url)?.fullName).toBe(fullName)
  })

  it.each([
    'git@gitlab.com:acme/checkout-api.git',
    'https://bitbucket.org/acme/checkout-api.git',
    'https://github.com/acme',
    '/Users/ritchey/Projects/local-only',
    'file:///Users/ritchey/Projects/local-only',
    ''
  ])('ignores %s', (url) => {
    expect(parseGitHubRemote(url)).toBeUndefined()
  })
})

describe('parseOriginUrl', () => {
  it('finds the origin url among other remotes and sections', () => {
    const config = `[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/thing.git\n[Remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n\turl = "https://github.com/acme/checkout-api.git" ; primary\n[remote "backup"]\n\turl = git@gitlab.com:x/y.git\n`
    expect(parseOriginUrl(config)).toBe('https://github.com/acme/checkout-api.git')
  })

  it('accepts the dotted section syntax', () => {
    expect(parseOriginUrl('[remote.origin]\nurl = git@github.com:a/b.git\n')).toBe('git@github.com:a/b.git')
  })

  it('returns undefined without an origin', () => {
    expect(parseOriginUrl('[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:a/b.git\n')).toBeUndefined()
  })
})

describe('expandHome', () => {
  it('expands ~ and ~/ only', () => {
    expect(expandHome('~', '/home/x')).toBe('/home/x')
    expect(expandHome('~/Projects', '/home/x')).toBe('/home/x/Projects')
    expect(expandHome('/abs/~/x', '/home/x')).toBe('/abs/~/x')
    expect(expandHome('~user/x', '/home/x')).toBe('~user/x')
  })
})

describe('RepoDiscovery', () => {
  it('finds repos one and two levels deep, dedupes, and skips what it should', async () => {
    const projects = join(home, 'Projects')
    await repo(join(projects, 'checkout-api'), 'git@github.com:acme/checkout-api.git', { originHead: 'main' })
    await repo(join(projects, 'nestedco', 'nested-api'), 'https://github.com/nestedco/nested-api.git', { originHead: 'develop' })
    await repo(join(projects, 'nestedco', 'nested-web'), 'ssh://git@github.com/nestedco/nested-web.git', { packedMain: true })
    await repo(join(projects, 'gitlab-thing'), 'git@gitlab.com:acme/thing.git')
    await repo(join(projects, 'node_modules', 'some-dep'), 'git@github.com:acme/some-dep.git')
    await repo(join(projects, '.hidden-repo'), 'git@github.com:acme/hidden.git')
    await repo(join(projects, 'too', 'deep', 'checkout-deep'), 'git@github.com:acme/checkout-deep.git')
    await repo(join(projects, 'zz-copy', 'checkout-api'), 'git@github.com:acme/checkout-api.git')
    await fs.mkdir(join(projects, 'plain-folder', 'src'), { recursive: true })
    await fs.writeFile(join(projects, 'a-file.txt'), 'not a dir')

    const repos = await new RepoDiscovery({ homeDir: home }).discover(['~/Projects', join(home, 'does-not-exist')])
    expect(repos).toEqual([
      { fullName: 'acme/checkout-api', path: join(projects, 'checkout-api'), defaultBranch: 'main' },
      { fullName: 'nestedco/nested-api', path: join(projects, 'nestedco', 'nested-api'), defaultBranch: 'develop' },
      { fullName: 'nestedco/nested-web', path: join(projects, 'nestedco', 'nested-web'), defaultBranch: 'main' }
    ])
  })

  it('prefers the shallower path when the same repo appears twice', async () => {
    const a = join(home, 'a')
    const b = join(home, 'b')
    await repo(join(a, 'nested', 'checkout-api'), 'git@github.com:acme/checkout-api.git')
    await repo(join(b, 'checkout-api'), 'git@github.com:acme/checkout-api.git')
    const repos = await new RepoDiscovery({ homeDir: home }).discover([a, b])
    expect(repos).toEqual([{ fullName: 'acme/checkout-api', path: join(b, 'checkout-api') }])
  })

  it('follows a .git file back to the main repository and prefers the main checkout', async () => {
    const projects = join(home, 'Projects')
    const main = join(projects, 'checkout-api')
    await repo(main, 'git@github.com:acme/checkout-api.git', { originHead: 'main' })
    const wtGitDir = join(main, '.git', 'worktrees', 'aaa-review')
    await fs.mkdir(wtGitDir, { recursive: true })
    await fs.writeFile(join(wtGitDir, 'commondir'), '../..\n')
    // Sorts before the main checkout, so only an explicit preference keeps the worktree from winning.
    await fs.mkdir(join(projects, 'aaa-review'), { recursive: true })
    await fs.writeFile(join(projects, 'aaa-review', '.git'), `gitdir: ${wtGitDir}\n`)

    const repos = await new RepoDiscovery({ homeDir: home }).discover([projects])
    expect(repos).toEqual([{ fullName: 'acme/checkout-api', path: main, defaultBranch: 'main' }])

    await fs.rm(main, { recursive: true, force: true })
    expect(await new RepoDiscovery({ homeDir: home }).discover([projects])).toEqual([])
  })

  it('returns nothing for empty or missing roots', async () => {
    expect(await new RepoDiscovery({ homeDir: home }).discover(['', '~/nope'])).toEqual([])
  })
})

describe('RepoDiscovery.discoverWorkspaces', () => {
  it('reports folders that are not repos themselves but hold at least two, and whether they carry a CLAUDE.md', async () => {
    const projects = join(home, 'Projects')
    await repo(join(projects, 'acme', 'acme-api'), 'git@github.com:acme/acme-api.git', { originHead: 'main' })
    await repo(join(projects, 'acme', 'acme-web'), 'https://github.com/acme/acme-web.git')
    await repo(join(projects, 'acme', 'acme-web-copy'), 'https://github.com/acme/acme-web.git')
    await repo(join(projects, 'acme', 'node_modules', 'dep'), 'git@github.com:acme/dep.git')
    await fs.writeFile(join(projects, 'acme', 'CLAUDE.md'), '# Router\n')
    await repo(join(projects, 'plain', 'one-api'), 'git@github.com:plain/one-api.git')
    await repo(join(projects, 'plain', 'one-web'), 'git@github.com:plain/one-web.git')
    await repo(join(projects, 'solo', 'only'), 'git@github.com:solo/only.git')
    await repo(join(projects, 'monorepo'), 'git@github.com:acme/monorepo.git')
    await repo(join(projects, 'monorepo', 'packages', 'a'), 'git@github.com:acme/a.git')
    await repo(join(projects, 'monorepo', 'packages', 'b'), 'git@github.com:acme/b.git')
    await repo(join(projects, 'elsewhere', 'x'), 'git@gitlab.com:else/x.git')
    await repo(join(projects, 'elsewhere', 'y'), 'git@gitlab.com:else/y.git')
    await repo(join(projects, '.hidden', 'x'), 'git@github.com:hidden/x.git')
    await repo(join(projects, '.hidden', 'y'), 'git@github.com:hidden/y.git')
    await fs.mkdir(join(projects, 'empty'), { recursive: true })
    await fs.writeFile(join(projects, 'a-file.txt'), 'not a dir')

    const workspaces = await new RepoDiscovery({ homeDir: home }).discoverWorkspaces(['~/Projects', join(home, 'nope'), ''])
    expect(workspaces).toEqual([
      { rootPath: join(projects, 'acme'), name: 'acme', repos: ['acme/acme-api', 'acme/acme-web'], hasClaudeMd: true },
      { rootPath: join(projects, 'plain'), name: 'plain', repos: ['plain/one-api', 'plain/one-web'], hasClaudeMd: false }
    ])
  })

  it('lists a container once when two roots reach it', async () => {
    const projects = join(home, 'Projects')
    await repo(join(projects, 'pair', 'a'), 'git@github.com:pair/a.git')
    await repo(join(projects, 'pair', 'b'), 'git@github.com:pair/b.git')
    const workspaces = await new RepoDiscovery({ homeDir: home }).discoverWorkspaces([projects, '~/Projects'])
    expect(workspaces.map((w) => w.rootPath)).toEqual([join(projects, 'pair')])
  })
})

describe('RepoDiscovery.readWorkspaceNotes', () => {
  const rootPath = '/Users/ritchey/Projects/acme'
  const memoryDir = () => join(home, '.claude', 'projects', encodeProjectPath(rootPath), 'memory')

  it('encodes the project path the way Claude Code keys its memory', () => {
    expect(encodeProjectPath(rootPath)).toBe('-Users-ritchey-Projects-acme')
  })

  it('renders MEMORY.md and the notes it links, skipping links that leave the folder or do not exist', async () => {
    await fs.mkdir(join(memoryDir(), 'sub'), { recursive: true })
    const index = [
      '# Memory',
      '- [Project decisions](project-decisions.md) — locked product decisions',
      '- [Review workflow](./review-workflow.md) — how reviews run',
      '- [Missing](missing.md) — deleted',
      '- [Outside](../outside.md)',
      '- [Deep](sub/deep.md)',
      '- [Project decisions](project-decisions.md) — linked twice'
    ].join('\n')
    await fs.writeFile(join(memoryDir(), 'MEMORY.md'), `${index}\n`)
    await fs.writeFile(join(memoryDir(), 'project-decisions.md'), '# Decisions\n\nBooking status `held` is new.\n')
    await fs.writeFile(join(memoryDir(), 'review-workflow.md'), 'Review from the container folder.\n')
    await fs.writeFile(join(memoryDir(), 'sub', 'deep.md'), 'should not load\n')
    await fs.writeFile(join(home, '.claude', 'projects', 'outside.md'), 'should not load\n')

    expect(linkedNoteFiles(index)).toEqual([
      { title: 'Project decisions', file: 'project-decisions.md' },
      { title: 'Review workflow', file: 'review-workflow.md' },
      { title: 'Missing', file: 'missing.md' }
    ])
    const notes = await new RepoDiscovery({ homeDir: home }).readWorkspaceNotes(rootPath)
    expect(notes).toBe(
      [index, '', '### Project decisions', '', '# Decisions', '', 'Booking status `held` is new.', '', '### Review workflow', '', 'Review from the container folder.'].join('\n')
    )
  })

  it('takes the Claude home from the option when given', async () => {
    const claudeHome = join(home, 'elsewhere')
    const dir = join(claudeHome, 'projects', encodeProjectPath(rootPath), 'memory')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'MEMORY.md'), '# Only the index\n')
    expect(await new RepoDiscovery({ homeDir: home, claudeHome }).readWorkspaceNotes(rootPath)).toBe('# Only the index')
    expect(await new RepoDiscovery({ homeDir: home }).readWorkspaceNotes(rootPath)).toBeUndefined()
  })

  it('returns undefined without a memory store', async () => {
    expect(await new RepoDiscovery({ homeDir: home }).readWorkspaceNotes(rootPath)).toBeUndefined()
    await fs.mkdir(memoryDir(), { recursive: true })
    expect(await new RepoDiscovery({ homeDir: home }).readWorkspaceNotes(rootPath)).toBeUndefined()
  })

  it('cuts each note and the whole document with a marker', async () => {
    await fs.mkdir(memoryDir(), { recursive: true })
    const files = ['a', 'b', 'c', 'd', 'e', 'f']
    await fs.writeFile(join(memoryDir(), 'MEMORY.md'), files.map((f) => `- [Note ${f}](${f}.md)`).join('\n'))
    for (const f of files) await fs.writeFile(join(memoryDir(), `${f}.md`), f.repeat(NOTES_FILE_CHARS + 1000))

    const notes = (await new RepoDiscovery({ homeDir: home }).readWorkspaceNotes(rootPath))!
    expect(notes).toContain(`### Note a\n\n${'a'.repeat(NOTES_FILE_CHARS)}\n… truncated`)
    expect(notes).not.toContain('a'.repeat(NOTES_FILE_CHARS + 1))
    expect(notes.endsWith('\n… truncated')).toBe(true)
    expect(notes.length).toBe(NOTES_TOTAL_CHARS + '\n… truncated'.length)
    expect(notes).not.toContain('### Note f')
  })
})

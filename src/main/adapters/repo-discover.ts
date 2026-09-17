import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DetectedWorkspace, LocalRepo } from '@core/domain'
import type { ReposPort } from '@core/ports'

const SKIP_DIRS = new Set(['node_modules'])
const DEFAULT_MAX_DEPTH = 2
/** Workspace notes are cut per file and in total so a sprawling memory store cannot crowd out the diff. */
export const NOTES_FILE_CHARS = 8_000
export const NOTES_TOTAL_CHARS = 40_000
const NOTES_TRUNCATED = '\n… truncated'
const DEFAULT_BRANCH_GUESSES = ['main', 'master']
/** github.com plus the ssh-config aliases people use for multiple accounts (github.com-work). */
const GITHUB_HOST = /^(?:ssh\.)?github\.com(?:-[\w.-]+)?$/i

export function expandHome(p: string, home: string = homedir()): string {
  if (p === '~') return home
  if (p.startsWith('~/')) return join(home, p.slice(2))
  return p
}

export interface ParsedRemote {
  owner: string
  name: string
  fullName: string
}

/** Accepts scp-like, ssh://, git://, http(s):// forms. Returns undefined for anything not on GitHub. */
export function parseGitHubRemote(url: string): ParsedRemote | undefined {
  const u = url.trim()
  let host: string | undefined
  let path: string | undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u)
  if (withScheme) {
    host = withScheme[1]
    path = withScheme[2]
  } else {
    const scpLike = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(u)
    if (scpLike) {
      host = scpLike[1]
      path = scpLike[2]
    }
  }
  if (!host || !path || !GITHUB_HOST.test(host)) return undefined
  const parts = path.split('/').filter(Boolean)
  const owner = parts[0]
  const name = parts[1]?.replace(/\.git$/i, '')
  if (!owner || !name) return undefined
  return { owner, name, fullName: `${owner}/${name}` }
}

function normalizeSection(header: string): string {
  const sub = /^(\S+)\s+"(.*)"$/.exec(header)
  if (sub) return `${sub[1]!.toLowerCase()} "${sub[2]}"`
  const dotted = /^([^.]+)\.(.+)$/.exec(header)
  if (dotted) return `${dotted[1]!.toLowerCase()} "${dotted[2]}"`
  return header.toLowerCase()
}

function unquote(value: string): string {
  const v = value.replace(/\s+[#;].*$/, '').trim()
  return v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v
}

/** The `url` of `[remote "origin"]` from a git config file, without shelling out. */
export function parseOriginUrl(config: string): string | undefined {
  let section = ''
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[([^\]]+)\]/.exec(line)
    if (header) {
      section = normalizeSection(header[1]!.trim())
      continue
    }
    if (section !== 'remote "origin"') continue
    const kv = /^url\s*=\s*(.+)$/i.exec(line)
    if (kv) return unquote(kv[1]!)
  }
  return undefined
}

/** Claude Code keys a project's memory store by its absolute path with every separator turned into '-'. */
export function encodeProjectPath(rootPath: string): string {
  return rootPath.replace(/[\\/]/g, '-')
}

function capNotes(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${NOTES_TRUNCATED}` : text
}

/** `[title](file.md)` links to files beside the index, in order of appearance, once each. */
export function linkedNoteFiles(index: string): { title: string; file: string }[] {
  const out: { title: string; file: string }[] = []
  const seen = new Set<string>()
  const link = /\[([^\]\n]+)\]\(([^)\s]+\.md)\)/g
  let m: RegExpExecArray | null
  while ((m = link.exec(index)) !== null) {
    const file = m[2]!.replace(/^\.\//, '')
    if (/[\\/]/.test(file) || seen.has(file)) continue
    seen.add(file)
    out.push({ title: m[1]!.trim(), file })
  }
  return out
}

/** MEMORY.md followed by each note it links, under its own heading, as one markdown document. */
export async function renderWorkspaceNotes(index: string, read: (file: string) => Promise<string | undefined>): Promise<string> {
  const parts = [capNotes(index.trim(), NOTES_FILE_CHARS)]
  for (const { title, file } of linkedNoteFiles(index)) {
    const content = await read(file)
    if (content === undefined) continue
    parts.push(`### ${title}\n\n${capNotes(content.trim(), NOTES_FILE_CHARS)}`)
  }
  return capNotes(parts.join('\n\n'), NOTES_TOTAL_CHARS)
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function readDirs(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function isDirectory(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

interface GitDir {
  path: string
  /** A `.git` file: a linked worktree or submodule rather than the main checkout. */
  linked: boolean
}

/**
 * Resolves the directory holding `config` and refs. A `.git` file points at a
 * linked worktree or submodule gitdir; worktrees then point back at the main
 * repository through `commondir`.
 */
async function commonGitDir(repoDir: string): Promise<GitDir | undefined> {
  const dotGit = join(repoDir, '.git')
  let st
  try {
    st = await fs.stat(dotGit)
  } catch {
    return undefined
  }
  let gitDir: string
  if (st.isDirectory()) {
    gitDir = dotGit
  } else if (st.isFile()) {
    const text = await readText(dotGit)
    const m = text && /^gitdir:\s*(.+)$/m.exec(text)
    if (!m) return undefined
    gitDir = resolve(repoDir, m[1]!.trim())
  } else {
    return undefined
  }
  const common = await readText(join(gitDir, 'commondir'))
  return { path: common ? resolve(gitDir, common.trim()) : gitDir, linked: st.isFile() }
}

async function readDefaultBranch(gitDir: string): Promise<string | undefined> {
  const head = await readText(join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'))
  const symref = head && /^ref:\s*refs\/remotes\/origin\/(.+)$/m.exec(head)
  if (symref) return symref[1]!.trim()
  for (const b of DEFAULT_BRANCH_GUESSES) {
    if (await exists(join(gitDir, 'refs', 'remotes', 'origin', b))) return b
  }
  const packed = await readText(join(gitDir, 'packed-refs'))
  if (packed) {
    for (const b of DEFAULT_BRANCH_GUESSES) {
      if (new RegExp(`^[0-9a-f]{40} refs/remotes/origin/${b}$`, 'm').test(packed)) return b
    }
  }
  return undefined
}

interface Candidate extends LocalRepo {
  depth: number
  linked: boolean
}

export class RepoDiscovery implements ReposPort {
  constructor(private readonly opts: { homeDir?: string; maxDepth?: number; claudeHome?: string } = {}) {}

  async discover(roots: string[]): Promise<LocalRepo[]> {
    const home = this.opts.homeDir ?? homedir()
    const maxDepth = this.opts.maxDepth ?? DEFAULT_MAX_DEPTH
    const found: Candidate[] = []
    for (const raw of roots) {
      const root = raw.trim()
      if (!root) continue
      await this.scan(resolve(expandHome(root, home)), 0, maxDepth, found)
    }
    // Shallowest first; at equal depth a main checkout beats a linked worktree of the same repo.
    found.sort((a, b) => a.depth - b.depth || Number(a.linked) - Number(b.linked))
    const byName = new Map<string, Candidate>()
    for (const c of found) if (!byName.has(c.fullName)) byName.set(c.fullName, c)
    return [...byName.values()]
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(({ fullName, path, defaultBranch }) => (defaultBranch ? { fullName, path, defaultBranch } : { fullName, path }))
  }

  async discoverWorkspaces(roots: string[]): Promise<DetectedWorkspace[]> {
    const home = this.opts.homeDir ?? homedir()
    const found: DetectedWorkspace[] = []
    const seen = new Set<string>()
    for (const raw of roots) {
      const root = raw.trim()
      if (!root) continue
      const dir = resolve(expandHome(root, home))
      for (const entry of (await readDirs(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        const child = join(dir, entry.name)
        if (seen.has(child) || !(await isDirectory(entry, child))) continue
        seen.add(child)
        // A repository is a project of its own, whatever it nests.
        if (await commonGitDir(child)) continue
        const repos = await this.reposDirectlyUnder(child)
        if (repos.length < 2) continue
        found.push({ rootPath: child, name: entry.name, repos, hasClaudeMd: await exists(join(child, 'CLAUDE.md')) })
      }
    }
    return found
  }

  async readWorkspaceNotes(rootPath: string): Promise<string | undefined> {
    const claudeHome = this.opts.claudeHome ?? join(this.opts.homeDir ?? homedir(), '.claude')
    const dir = join(claudeHome, 'projects', encodeProjectPath(rootPath), 'memory')
    const index = await readText(join(dir, 'MEMORY.md'))
    if (index === undefined) return undefined
    return renderWorkspaceNotes(index, (file) => readText(join(dir, file)))
  }

  private async reposDirectlyUnder(dir: string): Promise<string[]> {
    const names = new Set<string>()
    for (const entry of await readDirs(dir)) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (!(await isDirectory(entry, child))) continue
      const repo = await this.inspect(child)
      if (repo) names.add(repo.fullName)
    }
    return [...names].sort()
  }

  private async scan(dir: string, depth: number, maxDepth: number, found: Candidate[]): Promise<void> {
    if (depth > 0) {
      const repo = await this.inspect(dir)
      if (repo) found.push({ ...repo, depth })
    }
    if (depth >= maxDepth) return
    const entries = (await readDirs(dir)).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (!(await isDirectory(entry, child))) continue
      await this.scan(child, depth + 1, maxDepth, found)
    }
  }

  private async inspect(dir: string): Promise<Omit<Candidate, 'depth'> | undefined> {
    const git = await commonGitDir(dir)
    if (!git) return undefined
    const config = await readText(join(git.path, 'config'))
    if (!config) return undefined
    const url = parseOriginUrl(config)
    const remote = url ? parseGitHubRemote(url) : undefined
    if (!remote) return undefined
    const defaultBranch = await readDefaultBranch(git.path)
    const { linked } = git
    return defaultBranch ? { fullName: remote.fullName, path: dir, defaultBranch, linked } : { fullName: remote.fullName, path: dir, linked }
  }
}

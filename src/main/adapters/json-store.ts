import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { PersistedState, StorePort } from '@core/ports'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * One JSON file, written atomically (tmp + rename). A file that fails to parse
 * is moved aside rather than deleted so nothing is lost silently.
 */
export class JsonFileStore implements StorePort {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(public readonly filePath: string) {}

  async load(): Promise<PersistedState | null> {
    let text: string
    try {
      text = await fs.readFile(this.filePath, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      await this.quarantine()
      return null
    }
    if (!isPlainObject(parsed)) {
      await this.quarantine()
      return null
    }
    return parsed as unknown as PersistedState
  }

  save(state: PersistedState): Promise<void> {
    // Saves are serialised so two overlapping writes cannot race on the tmp file.
    const run = this.queue.then(() => this.write(state))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async write(state: PersistedState): Promise<void> {
    const tmp = `${this.filePath}.tmp`
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  private async quarantine(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.rename(this.filePath, `${this.filePath}.corrupt-${stamp}`).catch(() => undefined)
  }
}

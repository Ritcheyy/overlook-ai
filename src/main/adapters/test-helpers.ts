/** Fakes for the CLI runner tests: a child process that replays a script once the prompt has been written. */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { SpawnFn, SpawnOpts } from './cli-process'

export class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 4242
  kills: string[] = []
  stdinText = ''
  closed = false

  constructor(private readonly ignoreSigterm: boolean) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.stdinText += chunk.toString()
    })
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal)
    if (signal === 'SIGTERM' && this.ignoreSigterm) return true
    this.exit(null, signal)
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.closed) return
    this.closed = true
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code, signal))
  }
}

export interface SpawnCall {
  command: string
  args: string[]
  opts: SpawnOpts
  child: FakeChild
}

export type Script = (child: FakeChild) => void

export function fakeSpawn(script: Script, opts: { ignoreSigterm?: boolean } = {}): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = (command, args, o) => {
    const child = new FakeChild(opts.ignoreSigterm ?? false)
    calls.push({ command, args, opts: o, child })
    // Replay only after the prompt has been fully written, like a real CLI reading stdin.
    child.stdin.on('end', () => script(child))
    return child
  }
  return { spawn, calls }
}

export const line = (obj: unknown): string => JSON.stringify(obj) + '\n'

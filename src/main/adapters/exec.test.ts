import { describe, expect, it } from 'vitest'
import { exec } from './exec'

const node = process.execPath

describe('exec', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const res = await exec(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'])
    expect(res).toEqual({ stdout: 'out', stderr: 'err', code: 3 })
  })

  it('streams complete stdout lines and flushes the trailing partial line', async () => {
    const lines: string[] = []
    const script = 'process.stdout.write("a\\r\\nb\\n"); setTimeout(() => process.stdout.write("c"), 5)'
    const res = await exec(node, ['-e', script], { onLine: (l) => lines.push(l) })
    expect(res.code).toBe(0)
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('streams stderr lines separately', async () => {
    const err: string[] = []
    const out: string[] = []
    await exec(node, ['-e', 'console.error("e1"); console.log("o1")'], { onLine: (l) => out.push(l), onErrorLine: (l) => err.push(l) })
    expect(out).toEqual(['o1'])
    expect(err).toEqual(['e1'])
  })

  it('pipes input to stdin and closes it', async () => {
    const res = await exec(node, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello\nworld' })
    expect(res.stdout).toBe('hello\nworld')
  })

  it('closes stdin when no input is given so readers do not hang', async () => {
    const res = await exec(node, ['-e', 'let n = 0; process.stdin.on("data", (d) => n += d.length); process.stdin.on("end", () => { console.log(n); })'])
    expect(res.stdout.trim()).toBe('0')
  })

  it('honours cwd and env', async () => {
    const res = await exec(node, ['-e', 'console.log(process.cwd() + "|" + process.env.PRR_TEST)'], { cwd: '/', env: { PRR_TEST: 'yes' } })
    expect(res.stdout.trim()).toBe('/|yes')
  })

  it('rejects only when the command cannot be spawned', async () => {
    await expect(exec('/nonexistent/definitely-not-a-binary', [])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills the process on abort and reports a signal exit code', async () => {
    const ac = new AbortController()
    const p = exec(node, ['-e', 'setTimeout(() => {}, 30000)'], { signal: ac.signal })
    setTimeout(() => ac.abort(), 30)
    const res = await p
    expect(res.code).toBe(143)
    expect(res.stderr).toContain('aborted')
    expect(ac.signal.aborted).toBe(true)
  })

  it('does not run a command whose signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const res = await exec(node, ['-e', 'setTimeout(() => {}, 30000)'], { signal: ac.signal })
    expect(res.code).not.toBe(0)
    expect(res.stderr).toContain('aborted')
  })

  it('kills the process after the timeout', async () => {
    const res = await exec(node, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 40 })
    expect(res.code).toBe(143)
    expect(res.stderr).toContain('timed out after 40ms')
  })

  it('resolves once the process exits even if a grandchild still holds the pipes', async () => {
    const started = Date.now()
    const res = await exec('sh', ['-c', 'sleep 3 & echo hi; exit 0'])
    expect(res).toMatchObject({ stdout: 'hi\n', code: 0 })
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('kills the whole process group on abort', async () => {
    const ac = new AbortController()
    let grandchild = 0
    const res = await exec('sh', ['-c', 'sleep 30 & echo $!; wait'], {
      signal: ac.signal,
      onLine: (l) => {
        grandchild = Number(l)
        ac.abort()
      }
    })
    expect(res.code).toBe(143)
    expect(grandchild).toBeGreaterThan(0)
    expect(await gone(grandchild)).toBe(true)
  })

  it('rejects and stops the process when a line callback throws', async () => {
    const started = Date.now()
    await expect(
      exec(node, ['-e', 'console.log("a"); setTimeout(() => {}, 30000)'], {
        onLine: () => {
          throw new Error('boom')
        }
      })
    ).rejects.toThrow('boom')
    expect(Date.now() - started).toBeLessThan(2500)
  })
})

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}

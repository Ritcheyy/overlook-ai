import { describe, expect, it } from 'vitest'
import { expandHome, joinPath, parsePrId, worktreePathFor } from './paths'

describe('joinPath', () => {
  it('joins with single slashes', () => {
    expect(joinPath('/a', 'b', 'c')).toBe('/a/b/c')
    expect(joinPath('/a/', '/b/', 'c/')).toBe('/a/b/c')
    expect(joinPath('a', '', 'b')).toBe('a/b')
  })

  it('keeps a lone root and returns empty for nothing', () => {
    expect(joinPath('/')).toBe('/')
    expect(joinPath()).toBe('')
  })
})

describe('expandHome', () => {
  it('expands a leading tilde', () => {
    expect(expandHome('~', '/Users/demo')).toBe('/Users/demo')
    expect(expandHome('~/x/y', '/Users/demo')).toBe('/Users/demo/x/y')
    expect(expandHome('~/', '/Users/demo')).toBe('/Users/demo')
  })

  it('leaves other paths alone', () => {
    expect(expandHome('/abs/~/x', '/Users/demo')).toBe('/abs/~/x')
    expect(expandHome('~user/x', '/Users/demo')).toBe('~user/x')
    expect(expandHome('relative', '/Users/demo')).toBe('relative')
  })
})

describe('worktreePathFor', () => {
  it('builds root/owner/name/pr-n', () => {
    const pr = { number: 412, repo: { owner: 'acme', name: 'checkout-api' } }
    expect(worktreePathFor('~/.overlook/worktrees', pr, '/Users/demo')).toBe(
      '/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412'
    )
    expect(worktreePathFor('/tmp/wt/', pr, '/Users/demo')).toBe('/tmp/wt/acme/checkout-api/pr-412')
  })
})

describe('parsePrId', () => {
  it('parses owner/name#number', () => {
    expect(parsePrId('acme/checkout-api#412')).toEqual({ fullName: 'acme/checkout-api', number: 412 })
  })

  it('rejects malformed ids', () => {
    expect(parsePrId('acme/checkout-api')).toBeUndefined()
    expect(parsePrId('#12')).toBeUndefined()
    expect(parsePrId('acme#12')).toBeUndefined()
    expect(parsePrId('acme/x#abc')).toBeUndefined()
    expect(parsePrId('acme/x#0')).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { unwrapRemoteError } from './remote-error'

describe('unwrapRemoteError', () => {
  it('strips the channel prefix and the error class from a handler error', () => {
    const e = unwrapRemoteError(new Error("Error invoking remote method 'api:postComment': Error: Mission not found: nope"))
    expect(e.message).toBe('Mission not found: nope')
  })

  it('handles subclassed errors and messages that contain colons', () => {
    const e = unwrapRemoteError(new Error("Error invoking remote method 'api:dispatch': TypeError: Cannot read properties of undefined (reading 'prId')"))
    expect(e.message).toBe("Cannot read properties of undefined (reading 'prId')")
    expect(unwrapRemoteError(new Error("Error invoking remote method 'api:x': Error: GitHub API: 502 Bad Gateway")).message).toBe('GitHub API: 502 Bad Gateway')
  })

  it('keeps a thrown non-Error value as the message', () => {
    expect(unwrapRemoteError(new Error("Error invoking remote method 'api:x': boom")).message).toBe('boom')
  })

  it('returns errors without the prefix untouched', () => {
    const original = new Error('No handler registered')
    expect(unwrapRemoteError(original)).toBe(original)
  })

  it('wraps non-Error rejections', () => {
    const e = unwrapRemoteError('offline')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('offline')
  })
})

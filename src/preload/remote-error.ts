// ipcRenderer.invoke rejects with "Error invoking remote method 'api:x': Error: <message>".
// The UI puts messages straight into toasts, so hand it the engine's message alone.
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/

export function unwrapRemoteError(e: unknown): Error {
  if (!(e instanceof Error)) return new Error(String(e))
  const message = e.message.replace(REMOTE_ERROR_PREFIX, '')
  return message === e.message ? e : new Error(message)
}

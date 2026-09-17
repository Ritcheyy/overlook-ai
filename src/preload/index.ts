import { contextBridge, ipcRenderer } from 'electron'
import type { ApiArgs, ApiMethod, ApiResult, Bridge, PushEvent, PushEvents } from '@core/ipc-contract'
import { apiChannel, pushChannel } from '@core/ipc-contract'
import { unwrapRemoteError } from './remote-error'

const bridge: Bridge = {
  async invoke<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>> {
    try {
      return (await ipcRenderer.invoke(apiChannel(method), ...args)) as ApiResult<M>
    } catch (e) {
      throw unwrapRemoteError(e)
    }
  },
  on<E extends PushEvent>(event: E, cb: (payload: PushEvents[E]) => void): () => void {
    const channel = pushChannel(event)
    const listener = (_e: Electron.IpcRendererEvent, payload: PushEvents[E]) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('bridge', bridge)

import { useMemo } from 'react'
import type { RunOptions } from '@core/domain'
import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'

export function useMissionActions() {
  const pushToast = useAppStore((s) => s.pushToast)
  return useMemo(() => {
    const run = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (e) {
        pushToast({ kind: 'error', title: `${label} failed`, body: (e as Error).message })
      }
    }
    return {
      dispatch: (prId: string, loadoutId?: string, options?: RunOptions) => run('Review', () => api.dispatch({ prId, loadoutId, options })),
      rerun: (id: string, loadoutId?: string, options?: RunOptions) => run('Re-run', () => api.rerunMission(id, loadoutId, options)),
      retry: (id: string) => run('Retry', () => api.retryMission(id)),
      cancel: (id: string) => run('Cancel', () => api.cancelMission(id)),
      close: (id: string) => run('Close review', () => api.closeMission(id)),
      setSummary: (id: string, roundId: string, summary: string) => run('Summary edit', () => api.setRoundSummary({ missionId: id, roundId, summary })),
      setAutoFollowUp: (id: string, enabled: boolean) => run('Automatic follow-ups', () => api.setAutoFollowUp({ missionId: id, enabled }))
    }
  }, [pushToast])
}

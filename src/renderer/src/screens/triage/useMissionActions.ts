import { useMemo } from 'react'
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
      rerun: (id: string, loadoutId?: string) => run('Re-run', () => api.rerunMission(id, loadoutId)),
      retry: (id: string) => run('Retry', () => api.retryMission(id)),
      cancel: (id: string) => run('Cancel', () => api.cancelMission(id)),
      close: (id: string) => run('Close mission', () => api.closeMission(id)),
      setSummary: (id: string, roundId: string, summary: string) => run('Summary edit', () => api.setRoundSummary({ missionId: id, roundId, summary })),
      setAutoFollowUp: (id: string, enabled: boolean) => run('Auto follow-up', () => api.setAutoFollowUp({ missionId: id, enabled }))
    }
  }, [pushToast])
}

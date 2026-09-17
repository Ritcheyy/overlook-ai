import { useEffect } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore, type Screen } from '@/state/store'
import { Button } from '@/components/ui/Button'
import { NAV_ITEMS, Rail } from '@/components/app/Rail'
import { ToastHost } from '@/components/app/ToastHost'
import { FloorScreen } from '@/screens/floor'
import { InboxScreen } from '@/screens/inbox'
import { TriageScreen } from '@/screens/triage'
import { LogScreen } from '@/screens/log'
import { SettingsScreen } from '@/screens/settings'

/** In Electron a plain anchor would navigate the window; hand http(s) links to the OS instead. */
function useExternalLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) return
      e.preventDefault()
      void api.openExternal(href)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

function useScreenShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const item = NAV_ITEMS.find((n) => n.key === e.key)
      if (!item) return
      e.preventDefault()
      useAppStore.getState().navigate(item.screen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function ScreenView({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'floor':
      return <FloorScreen />
    case 'inbox':
      return <InboxScreen />
    case 'triage':
      return <TriageScreen />
    case 'log':
      return <LogScreen />
    case 'settings':
      return <SettingsScreen />
  }
}

function LoadingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted" role="status" aria-live="polite">
      <LoaderCircle className="h-5 w-5 animate-spin text-accent" aria-hidden />
      <div className="text-[13px]">Connecting to the engine…</div>
    </div>
  )
}

function ErrorState({ error }: { error?: string }) {
  const refresh = useAppStore((s) => s.refresh)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center" role="alert">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose/30 bg-rose/10 text-rose">
        <CircleAlert className="h-4 w-4" aria-hidden />
      </div>
      <div className="text-[13px] font-medium text-ink">The engine did not answer</div>
      <div className="max-w-[420px] break-words font-mono text-[12px] text-muted">{error ?? 'No snapshot was received.'}</div>
      <Button variant="secondary" onClick={() => void refresh()}>
        Try again
      </Button>
    </div>
  )
}

export function App() {
  const screen = useAppStore((s) => s.screen)
  const hasSnapshot = useAppStore((s) => s.snapshot !== null)
  const loading = useAppStore((s) => s.loading)
  const error = useAppStore((s) => s.error)

  useEffect(() => {
    void useAppStore.getState().init()
  }, [])
  useExternalLinks()
  useScreenShortcuts()

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-ink">
      <Rail />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {hasSnapshot ? <ScreenView screen={screen} /> : loading ? <LoadingState /> : <ErrorState error={error} />}
      </main>
      <ToastHost />
    </div>
  )
}

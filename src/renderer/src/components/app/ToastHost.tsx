import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import type { NotificationAction } from '@core/domain'
import { performNotificationAction } from '@core/notifications'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAppStore, type Toast } from '@/state/store'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

const ICON = {
  info: <Info className="h-4 w-4 text-accent" aria-hidden />,
  success: <CircleCheck className="h-4 w-4 text-lime" aria-hidden />,
  error: <CircleAlert className="h-4 w-4 text-rose" aria-hidden />
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast)
  const openDetails = useAppStore((s) => s.openDetails)
  const pushToast = useAppStore((s) => s.pushToast)
  const clickable = !!toast.missionId || !!toast.prId
  // The text itself opens the details, so an Open button would only repeat it.
  const actions = (toast.actions ?? []).filter((a) => a.id !== 'open')
  const open = () => {
    if (!clickable) return
    openDetails({ missionId: toast.missionId, prId: toast.prId })
    dismiss(toast.id)
  }
  const run = (action: NotificationAction) => {
    dismiss(toast.id)
    performNotificationAction(api, { title: toast.title, body: toast.body ?? '', missionId: toast.missionId, prId: toast.prId }, action.id)
      .then((target) => {
        if (target) openDetails({ missionId: target.missionId, prId: target.prId })
      })
      .catch((e: Error) => pushToast({ kind: 'error', title: `${action.label} failed`, body: e.message }))
  }
  const Body = clickable ? 'button' : 'div'
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-raised py-2.5 pl-3 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] animate-toast-in',
        toast.kind === 'error' ? 'border-rose/30' : 'border-line'
      )}
    >
      <span className="mt-px shrink-0">{ICON[toast.kind]}</span>
      <div className="min-w-0 flex-1">
        <Body
          type={clickable ? 'button' : undefined}
          onClick={clickable ? open : undefined}
          className={cn('block w-full min-w-0 text-left', clickable && 'cursor-pointer rounded hover:text-ink')}
        >
          <div className="truncate text-[13px] font-medium text-ink">{toast.title}</div>
          {toast.body && <div className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-[12px] leading-snug text-muted">{toast.body}</div>}
          {clickable && actions.length === 0 && <div className="mt-1 text-[11px] text-accent">Open the details</div>}
        </Body>
        {actions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {actions.map((a, i) => (
              <Button key={a.id} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => run(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <IconButton size="sm" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
        <X />
      </IconButton>
    </div>
  )
}

export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    // Above the triage action bar, so a toast never covers the Post button.
    <div className="pointer-events-none fixed bottom-16 right-4 z-[60] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

import { Bell, CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import type { Notification, NotificationAction, PendingNotification } from '@core/domain'
import { performNotificationAction } from '@core/notifications'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { selectNotifications, useAppStore, type Toast } from '@/state/store'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

const ICON = {
  info: <Info className="h-4 w-4 text-accent" aria-hidden />,
  success: <CircleCheck className="h-4 w-4 text-lime" aria-hidden />,
  error: <CircleAlert className="h-4 w-4 text-rose" aria-hidden />,
  notification: <Bell className="h-4 w-4 text-accent" aria-hidden />
}

/** Older pending notifications wait behind these until one is dealt with. */
const VISIBLE_NOTIFICATIONS = 4

interface CardProps {
  kind: keyof typeof ICON
  title: string
  body?: string
  target?: Pick<Notification, 'missionId' | 'prId'>
  actions?: NotificationAction[]
  onDismiss: () => void
  onAction?: (action: NotificationAction) => void
}

function Card({ kind, title, body, target, actions = [], onDismiss, onAction }: CardProps) {
  const openDetails = useAppStore((s) => s.openDetails)
  const clickable = !!target?.missionId || !!target?.prId
  // The text itself opens the details, so an Open button would only repeat it.
  const buttons = actions.filter((a) => a.id !== 'open')
  const open = () => {
    if (!clickable) return
    openDetails({ missionId: target?.missionId, prId: target?.prId })
    onDismiss()
  }
  const Body = clickable ? 'button' : 'div'
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-raised py-2.5 pl-3 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] animate-toast-in',
        kind === 'error' ? 'border-rose/30' : 'border-line'
      )}
    >
      <span className="mt-px shrink-0">{ICON[kind]}</span>
      <div className="min-w-0 flex-1">
        <Body type={clickable ? 'button' : undefined} onClick={clickable ? open : undefined} className={cn('block w-full min-w-0 text-left', clickable && 'cursor-pointer rounded hover:text-ink')}>
          <div className="truncate text-[13px] font-medium text-ink">{title}</div>
          {body && <div className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-[12px] leading-snug text-muted">{body}</div>}
          {clickable && buttons.length === 0 && <div className="mt-1 text-[11px] text-accent">Open the details</div>}
        </Body>
        {buttons.length > 0 && onAction && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {buttons.map((a, i) => (
              <Button key={a.id} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => onAction(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <IconButton size="sm" aria-label="Dismiss notification" onClick={onDismiss}>
        <X />
      </IconButton>
    </div>
  )
}

/** A notification the engine holds; it leaves when dismissed, opened or acted on. */
function PendingItem({ n }: { n: PendingNotification }) {
  const openDetails = useAppStore((s) => s.openDetails)
  const pushToast = useAppStore((s) => s.pushToast)
  const dismiss = () => void api.dismissNotification(n.id).catch(() => undefined)
  const run = (action: NotificationAction) => {
    dismiss()
    performNotificationAction(api, n, action.id)
      .then((target) => {
        if (target) openDetails({ missionId: target.missionId, prId: target.prId })
      })
      .catch((e: Error) => pushToast({ kind: 'error', title: `${action.label} failed`, body: e.message }))
  }
  return <Card kind="notification" title={n.title} body={n.body} target={n} actions={n.actions} onDismiss={dismiss} onAction={run} />
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast)
  return <Card kind={toast.kind} title={toast.title} body={toast.body} target={toast} onDismiss={() => dismiss(toast.id)} />
}

export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts)
  const pending = useAppStore(selectNotifications)
  const shown = pending.slice(-VISIBLE_NOTIFICATIONS)
  const waiting = pending.length - shown.length
  if (toasts.length === 0 && pending.length === 0) return null
  return (
    // Above the triage action bar, so a toast never covers the Post button.
    <div className="pointer-events-none fixed bottom-16 right-4 z-[60] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {waiting > 0 && <div className="pointer-events-auto self-end rounded-md bg-raised px-2 py-0.5 text-[11px] text-faint">{waiting} more waiting</div>}
      {shown.map((n) => (
        <PendingItem key={n.id} n={n} />
      ))}
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/state/store'
import { IconButton } from '../ui/IconButton'

/** Polls GitHub now. Every copy spins together while the poll runs. */
export function RefreshButton({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const refreshing = useAppStore((s) => s.refreshing)
  const refreshInbox = useAppStore((s) => s.refreshInbox)
  return (
    <IconButton size={size} aria-label="Refresh inbox" title="Refresh inbox (⌘R)" className={className} disabled={refreshing} onClick={() => void refreshInbox()}>
      <RefreshCw className={cn(refreshing && 'animate-spin')} />
    </IconButton>
  )
}

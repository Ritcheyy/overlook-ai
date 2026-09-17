import type { MissionState } from '@core/domain'
import { Chip, type Tone } from '../ui/Chip'

export interface StateMeta {
  label: string
  tone: Tone
  pulse?: boolean
}

export const MISSION_STATE_META: Record<MissionState, StateMeta> = {
  queued: { label: 'Queued', tone: 'muted' },
  preparing: { label: 'Preparing', tone: 'accent' },
  reviewing: { label: 'Reviewing', tone: 'accent', pulse: true },
  needs_you: { label: 'Needs you', tone: 'amber' },
  posting: { label: 'Posting', tone: 'accent' },
  watching: { label: 'Watching', tone: 'teal' },
  failed: { label: 'Failed', tone: 'rose' },
  closed: { label: 'Closed', tone: 'faint' }
}

export const MISSION_STATES: readonly MissionState[] = ['queued', 'preparing', 'reviewing', 'needs_you', 'posting', 'watching', 'failed', 'closed']

export interface StateChipProps {
  state: MissionState
  onClick?: () => void
  size?: 'xs' | 'sm'
  className?: string
  title?: string
}

export function StateChip({ state, onClick, size, className, title }: StateChipProps) {
  const meta = MISSION_STATE_META[state]
  return (
    <Chip tone={meta.tone} dot pulse={meta.pulse} size={size} onClick={onClick} className={className} title={title} data-state={state}>
      {meta.label}
    </Chip>
  )
}

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Mission } from '@core/domain'
import { selectSettings, useAppStore } from '@/state/store'
import { Button, type ButtonVariant } from '@/components/ui/Button'
import { Select, type SelectOption } from '@/components/ui/Select'
import { useMissionActions } from './useMissionActions'

export interface RerunControlProps {
  mission: Mission
  variant?: ButtonVariant
  disabled?: boolean
}

/** Loadout picker next to a Re-run button; starts on the loadout the mission last ran with. */
export function RerunControl({ mission, variant = 'ghost', disabled }: RerunControlProps) {
  const actions = useMissionActions()
  const settings = useAppStore(selectSettings)
  const [loadoutId, setLoadoutId] = useState(mission.loadoutId)
  useEffect(() => setLoadoutId(mission.loadoutId), [mission.loadoutId])
  const options: SelectOption[] = (settings?.loadouts ?? []).map((l) => ({ value: l.id, label: l.name }))
  // A loadout deleted from settings must stay selectable so the picker never shows a blank.
  if (!options.some((o) => o.value === loadoutId)) options.unshift({ value: loadoutId, label: loadoutId })
  return (
    <span className="inline-flex items-center gap-1">
      <Select
        size="sm"
        aria-label="Loadout for the next round"
        value={loadoutId}
        disabled={disabled}
        onChange={(e) => setLoadoutId(e.target.value)}
        options={options}
        wrapperClassName="w-[150px]"
      />
      <Button
        size="sm"
        variant={variant}
        icon={<RotateCcw className="h-3.5 w-3.5" />}
        disabled={disabled}
        title="Start a fresh round on the current head with this loadout"
        onClick={() => void actions.rerun(mission.id, loadoutId)}
      >
        Re-run
      </Button>
    </span>
  )
}

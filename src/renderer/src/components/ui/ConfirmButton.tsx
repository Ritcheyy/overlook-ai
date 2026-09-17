import { useEffect, useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick'> {
  confirmLabel?: ReactNode
  onConfirm: () => void
  /** How long the armed state lasts before it reverts. */
  timeoutMs?: number
}

/** Two-click confirmation without a modal: the first click arms, the second fires. */
export function ConfirmButton({ confirmLabel = 'Confirm?', onConfirm, timeoutMs = 4000, children, variant, ...rest }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), timeoutMs)
    return () => clearTimeout(t)
  }, [armed, timeoutMs])
  return (
    <Button
      {...rest}
      variant={armed ? 'danger' : variant}
      aria-live="polite"
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : children}
    </Button>
  )
}

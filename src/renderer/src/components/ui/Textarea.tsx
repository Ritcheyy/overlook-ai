import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { INPUT_CLASS } from './Input'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ mono, className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(INPUT_CLASS, 'min-h-[72px] resize-y px-2.5 py-1.5 leading-relaxed', mono ? 'font-mono text-[12px]' : 'text-[13px]', className)}
      {...rest}
    />
  )
})

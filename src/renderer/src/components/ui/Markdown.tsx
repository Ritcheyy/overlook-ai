import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'

export interface MarkdownProps {
  children: string
  className?: string
}

/**
 * Raw HTML is not rendered (no rehype-raw), so the `<details>` blocks the
 * comment builder emits would appear as literal tags. Unwrap them into a
 * bold summary line followed by their content.
 */
export function unwrapDetails(md: string): string {
  return md
    .replace(/^[ \t]*<details>[ \t]*$/gm, '')
    .replace(/^[ \t]*<\/details>[ \t]*$/gm, '')
    .replace(/^[ \t]*<summary>(.*?)<\/summary>[ \t]*$/gm, '**$1**')
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('md text-[13px] text-ink/90', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{unwrapDetails(children)}</ReactMarkdown>
    </div>
  )
}

import { useRef } from 'react'
import { ChevronRight, Code2, Github } from 'lucide-react'
import type { DropReason, Finding, FindingCategory, FindingDecision } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relatedPrUrl } from '@/lib/links'
import { Chip, type Tone } from '@/components/ui/Chip'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Markdown } from '@/components/ui/Markdown'
import { Segmented } from '@/components/ui/Segmented'
import { Select } from '@/components/ui/Select'
import { SeverityDot } from '@/components/app/SeverityDot'

/** Categories with a colour of their own; the rest read as plain labels. */
const CATEGORY_TONE: Partial<Record<FindingCategory, Tone>> = { integration: 'teal' }

export const DROP_REASONS: { value: DropReason; label: string }[] = [
  { value: 'product_decision', label: 'Product decision' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'already_known', label: 'Already known' },
  { value: 'not_worth_it', label: 'Not worth it' },
  { value: 'other', label: 'Other' }
]

const DROP_LABEL = Object.fromEntries(DROP_REASONS.map((r) => [r.value, r.label])) as Record<DropReason, string>

export interface DecisionPatch {
  decision: FindingDecision
  dropReason?: DropReason
  dropNote?: string
}

export interface FileLinks {
  /** Opens the file at the line in the editor, from the worktree. */
  editor?: string
  editorLabel?: string
  github?: string
}

export interface FindingRowProps {
  finding: Finding
  /** Where the finding sits in the posted comment, which is how the author's reply refers to it. */
  number?: number
  /** Decisions can be made; otherwise the decision is shown as it was taken. */
  triage: boolean
  readOnly?: boolean
  expanded: boolean
  onToggle: () => void
  links?: FileLinks
  onDecision?: (patch: DecisionPatch) => void
  /** Opens the PR a finding depends on; GitHub when omitted. */
  onOpenRelated?: (ref: string) => void
}

type Choice = 'approved' | 'dropped'

function DecisionBadge({ finding }: { finding: Finding }) {
  if (finding.decision === 'approved') return <span className="shrink-0 text-[11.5px] text-lime/90">Posted</span>
  if (finding.decision === 'dropped') {
    return (
      <span className="shrink-0 text-[11.5px] text-faint" title={finding.dropNote}>
        Dropped{finding.dropReason ? ` · ${DROP_LABEL[finding.dropReason]}` : ''}
      </span>
    )
  }
  return <span className="shrink-0 text-[11.5px] text-faint">Not posted</span>
}

/** One finding as a single line: severity, title, file and decision. The body and suggestion open underneath. */
export function FindingRow({ finding, number, triage, readOnly, expanded, onToggle, links, onDecision, onOpenRelated }: FindingRowProps) {
  const noteRef = useRef<HTMLInputElement>(null)
  const choice: Choice | undefined = finding.decision === 'pending' ? undefined : finding.decision
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : undefined
  const bodyId = `finding-body-${finding.id}`

  const choose = (c: Choice) => {
    if (c === 'approved') onDecision?.({ decision: 'approved' })
    else onDecision?.({ decision: 'dropped', dropReason: finding.dropReason, dropNote: finding.dropNote })
  }
  const saveNote = () => {
    const value = noteRef.current?.value.trim() ?? ''
    if ((finding.dropNote ?? '') === value) return
    onDecision?.({ decision: 'dropped', dropReason: finding.dropReason, dropNote: value || undefined })
  }

  return (
    <li
      data-decision={finding.decision}
      className={cn(
        'rounded-lg border border-line bg-surface transition-[opacity,border-color]',
        triage && finding.decision === 'approved' && 'border-l-2 border-l-lime/70',
        finding.decision === 'dropped' && 'opacity-60 hover:opacity-100',
        triage && finding.decision === 'dropped' && 'border-l-2 border-l-faint/60'
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', expanded && 'rotate-90')} aria-hidden />
          {number !== undefined && <span className="mt-px shrink-0 font-mono text-[11.5px] tabular-nums text-faint">{number}.</span>}
          <SeverityDot severity={finding.severity} label className="mt-px shrink-0" />
          <span className={cn('min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink', !expanded && 'line-clamp-2')}>{finding.title}</span>
        </button>
        {triage ? (
          <Segmented<Choice>
            aria-label={`Decision for: ${finding.title}`}
            size="sm"
            value={choice}
            onChange={choose}
            disabled={readOnly}
            options={[
              { value: 'approved', label: 'Approve', activeClass: 'text-lime' },
              { value: 'dropped', label: 'Drop', activeClass: 'text-rose' }
            ]}
          />
        ) : (
          <DecisionBadge finding={finding} />
        )}
      </div>
      <div className="-mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-2 pl-[38px] pr-3">
        <Chip tone={CATEGORY_TONE[finding.category] ?? 'muted'} className="font-normal capitalize">
          {finding.category}
        </Chip>
        {location && (
          <span className="inline-flex min-w-0 items-center gap-0.5">
            {links?.editor ? (
              <button
                type="button"
                onClick={() => void api.openExternal(links.editor!)}
                aria-label={`Open ${location} in ${links.editorLabel ?? 'the editor'}`}
                title={`Open ${location} in ${links.editorLabel ?? 'the editor'}`}
                className="inline-flex min-w-0 items-center gap-1 rounded px-1 font-mono text-[11.5px] text-muted hover:bg-raised hover:text-accent"
              >
                <Code2 className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{location}</span>
              </button>
            ) : (
              <span className="truncate px-1 font-mono text-[11.5px] text-muted" title={location}>
                {location}
              </span>
            )}
            {links?.github && (
              <IconButton size="sm" aria-label={`Open ${location} on GitHub`} onClick={() => void api.openExternal(links.github!)}>
                <Github />
              </IconButton>
            )}
          </span>
        )}
        {finding.relatedPr && (
          <Chip
            tone="teal"
            mono
            className="font-normal"
            title={onOpenRelated ? `Open ${finding.relatedPr}` : `Open ${finding.relatedPr} on GitHub`}
            onClick={() => (onOpenRelated ? onOpenRelated(finding.relatedPr!) : void api.openExternal(relatedPrUrl(finding.relatedPr!)))}
          >
            depends on {finding.relatedPr}
          </Chip>
        )}
      </div>
      {expanded && (
        <div id={bodyId} className="border-t border-line/70 px-3.5 pb-3 pt-2.5">
          <Markdown className="text-[12.5px] text-muted">{finding.body}</Markdown>
          {finding.suggestion && (
            <details className="group mt-2 rounded-md border border-line bg-bg/60">
              <summary className="flex cursor-pointer select-none list-none items-center gap-1 px-2 py-1 text-[11.5px] font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
                Suggestion
              </summary>
              <div className="border-t border-line px-2.5 py-2">
                <Markdown className="text-[12.5px]">{finding.suggestion}</Markdown>
              </div>
            </details>
          )}
          {!triage && finding.decision === 'dropped' && finding.dropNote && <p className="mt-2 text-[12px] text-faint">Note: {finding.dropNote}</p>}
        </div>
      )}
      {/* Shown as soon as a finding is dropped, so the reason is one step away without opening the body. */}
      {triage && finding.decision === 'dropped' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-3.5 py-2">
          <label className="text-[11.5px] text-faint" htmlFor={`reason-${finding.id}`}>
            Dropped because
          </label>
          <Select
            id={`reason-${finding.id}`}
            size="sm"
            disabled={readOnly}
            value={finding.dropReason ?? ''}
            onChange={(e) => onDecision?.({ decision: 'dropped', dropReason: (e.target.value || undefined) as DropReason | undefined, dropNote: finding.dropNote })}
            wrapperClassName="w-[170px]"
          >
            <option value="">Choose a reason…</option>
            {DROP_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Input
            key={finding.dropNote ?? ''}
            ref={noteRef}
            size="sm"
            disabled={readOnly}
            defaultValue={finding.dropNote ?? ''}
            placeholder="Optional note (kept in the log)"
            aria-label="Drop note"
            onBlur={saveNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            wrapperClassName="w-auto min-w-[200px] flex-1"
          />
        </div>
      )}
    </li>
  )
}

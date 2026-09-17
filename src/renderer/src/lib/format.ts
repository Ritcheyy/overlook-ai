const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const WEEK = 7 * DAY

function toMs(now: number | Date): number {
  return typeof now === 'number' ? now : now.getTime()
}

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", then a short date. */
export function relativeTime(iso: string | undefined, now: number | Date = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = toMs(now) - t
  if (diff < 45_000) return 'just now'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`
  if (diff < WEEK) return `${Math.round(diff / DAY)}d ago`
  if (diff < 5 * WEEK) return `${Math.round(diff / WEEK)}w ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "42s", "2m 05s", "1h 04m". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function shortSha(sha: string | undefined): string {
  return (sha ?? '').slice(0, 7)
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** `formatUsd` for optional costs; "—" when the runner reported none. */
export function formatCost(usd: number | undefined): string {
  return usd === undefined || !Number.isFinite(usd) ? '—' : formatUsd(usd)
}

/** Milliseconds between an ISO timestamp and now (0 when unparseable). */
export function elapsedSince(iso: string | undefined, now: number | Date = Date.now()): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : Math.max(0, toMs(now) - t)
}

export function formatClock(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

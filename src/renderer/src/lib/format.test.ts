import { describe, expect, it } from 'vitest'
import { formatCost, formatDuration, formatUsd, plural, relativeTime, shortSha } from './format'

const NOW = new Date('2026-09-13T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('relativeTime', () => {
  it('buckets by minute, hour, day and week', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now')
    expect(relativeTime(ago(50_000), NOW)).toBe('1m ago')
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5m ago')
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe('2h ago')
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe('3d ago')
    expect(relativeTime(ago(14 * 86_400_000), NOW)).toBe('2w ago')
  })

  it('handles missing and invalid input', () => {
    expect(relativeTime(undefined, NOW)).toBe('—')
    expect(relativeTime('not a date', NOW)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
    expect(formatDuration(undefined)).toBe('—')
  })
})

describe('shortSha / plural / formatUsd', () => {
  it('shortens shas', () => {
    expect(shortSha('a1b2c3d4e5f6')).toBe('a1b2c3d')
    expect(shortSha(undefined)).toBe('')
  })
  it('pluralises', () => {
    expect(plural(1, 'finding')).toBe('1 finding')
    expect(plural(3, 'finding')).toBe('3 findings')
    expect(plural(0, 'entry', 'entries')).toBe('0 entries')
  })
  it('formats dollars', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(1.5)).toBe('$1.50')
    expect(formatCost(0.42)).toBe('$0.42')
    expect(formatCost(undefined)).toBe('—')
  })
})

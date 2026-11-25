import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, diffDays, dueLabel, startOfWeek } from './utils'

describe('addDays', () => {
  it('moves forwards and backwards across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-06-10', 0)).toBe('2026-06-10')
  })

  it('counts calendar days across daylight saving changes', () => {
    // Sanity check: the configured time zone really switches between these dates
    expect(new Date(2026, 2, 28).getTimezoneOffset()).not.toBe(new Date(2026, 2, 30).getTimezoneOffset())
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
  })
})

describe('diffDays', () => {
  it('returns the signed number of days from b to a', () => {
    expect(diffDays('2026-06-10', '2026-06-10')).toBe(0)
    expect(diffDays('2026-06-11', '2026-06-10')).toBe(1)
    expect(diffDays('2026-06-01', '2026-06-10')).toBe(-9)
    expect(diffDays('2027-01-01', '2026-01-01')).toBe(365)
  })

  it('is not thrown off by 23- or 25-hour days', () => {
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2)
    expect(diffDays('2026-10-26', '2026-10-24')).toBe(2)
  })

  it('is the inverse of addDays', () => {
    for (const n of [-400, -30, -1, 0, 1, 7, 84, 365]) {
      expect(diffDays(addDays('2026-03-15', n), '2026-03-15')).toBe(n)
    }
  })
})

describe('startOfWeek', () => {
  it('returns the Monday of the week', () => {
    expect(startOfWeek('2026-06-08')).toBe('2026-06-08') // Monday
    expect(startOfWeek('2026-06-10')).toBe('2026-06-08') // Wednesday
    expect(startOfWeek('2026-06-14')).toBe('2026-06-08') // Sunday belongs to the previous Monday
  })

  it('crosses month and year boundaries', () => {
    expect(startOfWeek('2026-07-02')).toBe('2026-06-29')
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29')
  })
})

describe('dueLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0)) // Wednesday, 10 June 2026, noon
  })
  afterEach(() => { vi.useRealTimers() })

  it('is empty without a due date', () => {
    expect(dueLabel(undefined)).toBe('')
    expect(dueLabel('')).toBe('')
  })

  it('names today, tomorrow and yesterday', () => {
    expect(dueLabel('2026-06-10')).toBe('Heute')
    expect(dueLabel('2026-06-11')).toBe('Morgen')
    expect(dueLabel('2026-06-09')).toBe('Gestern')
  })

  it('counts overdue days', () => {
    expect(dueLabel('2026-06-07')).toBe('3 Tage überfällig')
    expect(dueLabel('2026-05-31')).toBe('10 Tage überfällig')
  })

  it('uses the weekday within the next week and a date after that', () => {
    expect(dueLabel('2026-06-13')).toBe('Samstag')
    expect(dueLabel('2026-06-16')).toBe('Dienstag')
    const later = dueLabel('2026-06-17')
    expect(later).toMatch(/17/)
    expect(later).not.toBe('Mittwoch')
  })
})

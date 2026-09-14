import { describe, expect, it } from 'vitest'
import { SimpleCron } from '../src/cron'

const at = (iso: string) => new Date(iso)

describe('SimpleCron parsing', () => {
  it('rejects expressions that are not exactly five fields', () => {
    expect(() => new SimpleCron('* * * *')).toThrow(/exactly 5 parts/)
    expect(() => new SimpleCron('* * * * * *')).toThrow(/exactly 5 parts/)
  })

  it('folds day-of-week 7 onto Sunday', () => {
    // 2026-09-13 is a Sunday; the reference sits inside it so the next match is the following Sunday.
    const cron = new SimpleCron('0 0 * * 7')
    expect(cron.nextRun(at('2026-09-13T00:00:00Z'))?.toISOString()).toBe('2026-09-20T00:00:00.000Z')
  })

  it('expands lists, ranges and single values', () => {
    const cron = new SimpleCron('0,30 9-11 1 1 *')
    expect(cron.nextRun(at('2026-01-01T09:00:00Z'))?.toISOString()).toBe('2026-01-01T09:30:00.000Z')
    expect(cron.nextRun(at('2026-01-01T11:30:00Z'))?.toISOString()).toBe('2027-01-01T09:00:00.000Z')
  })

  it('expands step fields over a wildcard, a range and a single start', () => {
    expect(new SimpleCron('*/15 * * * *').nextRun(at('2026-01-01T00:16:00Z'))?.toISOString())
      .toBe('2026-01-01T00:30:00.000Z')
    expect(new SimpleCron('1-10/4 * * * *').nextRun(at('2026-01-01T00:05:00Z'))?.toISOString())
      .toBe('2026-01-01T00:09:00.000Z')
    // `5/10` starts at 5 and steps to the field maximum: 5, 15, 25, 35, 45, 55.
    expect(new SimpleCron('5/10 * * * *').nextRun(at('2026-01-01T00:56:00Z'))?.toISOString())
      .toBe('2026-01-01T01:05:00.000Z')
  })

  it('drops stepped values that fall outside the field bounds', () => {
    // Day-of-month starts at 1: the 0 produced by `0-10/5` is dropped, 5 and 10 stay.
    expect(new SimpleCron('0 0 0-10/5 * *').nextRun(at('2026-01-06T00:00:00Z'))?.toISOString())
      .toBe('2026-01-10T00:00:00.000Z')
    // Minutes stop at 59: the 60 and 65 produced by `50-65/5` are dropped, 50 and 55 stay.
    expect(new SimpleCron('50-65/5 * * * *').nextRun(at('2026-01-01T00:55:00Z'))?.toISOString())
      .toBe('2026-01-01T01:50:00.000Z')
  })

  it('rejects a missing, non-numeric or non-positive step', () => {
    expect(() => new SimpleCron('*/ * * * *')).toThrow(/Invalid step/)
    expect(() => new SimpleCron('*/x * * * *')).toThrow(/Invalid step/)
    expect(() => new SimpleCron('*/0 * * * *')).toThrow(/Invalid step/)
  })

  it('rejects malformed, inverted and out-of-bounds ranges', () => {
    expect(() => new SimpleCron('a-b * * * *')).toThrow(/Invalid range/)
    expect(() => new SimpleCron('1-b * * * *')).toThrow(/Invalid range/)
    expect(() => new SimpleCron('5-1 * * * *')).toThrow(/Invalid range/)
    expect(() => new SimpleCron('* * 0-5 * *')).toThrow(/Invalid range/)
    expect(() => new SimpleCron('1-70 * * * *')).toThrow(/Invalid range/)
  })

  it('rejects non-numeric and out-of-bounds single values', () => {
    expect(() => new SimpleCron('abc * * * *')).toThrow(/Invalid number/)
    expect(() => new SimpleCron('60 * * * *')).toThrow(/Invalid number/)
    expect(() => new SimpleCron('* * * 0 *')).toThrow(/Invalid number/)
  })
})

describe('SimpleCron.nextRun', () => {
  it('starts from the next full minute of the reference instant', () => {
    const cron = new SimpleCron('* * * * *')
    expect(cron.nextRun(at('2026-03-04T05:06:07.890Z'))?.toISOString()).toBe('2026-03-04T05:07:00.000Z')
  })

  it('defaults the reference to now', () => {
    const before = Date.now()
    const next = new SimpleCron('* * * * *').nextRun()!
    expect(next.getTime()).toBeGreaterThan(before)
    expect(next.getTime() - before).toBeLessThanOrEqual(60_000)
  })

  it('skips months, days, hours and minutes that do not match', () => {
    // Month skip: only March matches, so a January reference jumps to March 1st.
    expect(new SimpleCron('0 0 1 3 *').nextRun(at('2026-01-15T12:00:00Z'))?.toISOString())
      .toBe('2026-03-01T00:00:00.000Z')
    // Day skip: only the 20th matches.
    expect(new SimpleCron('0 0 20 * *').nextRun(at('2026-01-15T12:00:00Z'))?.toISOString())
      .toBe('2026-01-20T00:00:00.000Z')
    // Day-of-week skip: only Fridays match (2026-01-16 is a Friday).
    expect(new SimpleCron('0 0 * * 5').nextRun(at('2026-01-15T12:00:00Z'))?.toISOString())
      .toBe('2026-01-16T00:00:00.000Z')
    // Hour skip: only 18:00 matches.
    expect(new SimpleCron('0 18 * * *').nextRun(at('2026-01-15T12:00:00Z'))?.toISOString())
      .toBe('2026-01-15T18:00:00.000Z')
    // Minute skip: only :45 matches.
    expect(new SimpleCron('45 * * * *').nextRun(at('2026-01-15T12:10:00Z'))?.toISOString())
      .toBe('2026-01-15T12:45:00.000Z')
  })

  it('returns null when nothing matches inside the five-year window', () => {
    // February never has a 30th day.
    expect(new SimpleCron('0 0 30 2 *').nextRun(at('2026-01-01T00:00:00Z'))).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { RecurrenceEngine } from '../src/recurrence'

describe('RecurrenceEngine', () => {
  it('calculates next run for ONCE task in the future', () => {
    const future = new Date(Date.now() + 3600 * 1000)
    const next = RecurrenceEngine.calculateNextRun({
      scheduleType: 'ONCE',
      scheduleExpr: future.toISOString(),
      timezone: 'America/Sao_Paulo',
      maxRuns: 1,
      totalRunsCompleted: 0,
      endAt: null,
      createdAt: new Date(),
    })

    expect(next).not.toBeNull()
    expect(next?.getTime()).toBe(future.getTime())
  })

  it('returns null for ONCE task if already completed or in the past', () => {
    const past = new Date(Date.now() - 3600 * 1000)
    const next = RecurrenceEngine.calculateNextRun({
      scheduleType: 'ONCE',
      scheduleExpr: past.toISOString(),
      timezone: 'America/Sao_Paulo',
      maxRuns: 1,
      totalRunsCompleted: 0,
      endAt: null,
      createdAt: new Date(),
    })

    expect(next).toBeNull()
  })

  it('calculates next run for INTERVAL task', () => {
    const now = new Date('2026-09-03T10:00:00.000Z')
    const next = RecurrenceEngine.calculateNextRun(
      {
        scheduleType: 'INTERVAL',
        scheduleExpr: '3600', // 1 hour
        timezone: 'UTC',
        maxRuns: null,
        totalRunsCompleted: 5,
        endAt: null,
        createdAt: now,
      },
      now,
    )

    expect(next).not.toBeNull()
    expect(next?.toISOString()).toBe('2026-09-03T11:00:00.000Z')
  })

  it('calculates next run for CRON daily at 09:00', () => {
    const ref = new Date('2026-09-03T08:00:00.000Z')
    const next = RecurrenceEngine.calculateNextRun(
      {
        scheduleType: 'CRON',
        scheduleExpr: '0 9 * * *',
        timezone: 'UTC',
        maxRuns: null,
        totalRunsCompleted: 0,
        endAt: null,
        createdAt: ref,
      },
      ref,
    )

    expect(next).not.toBeNull()
    expect(next?.toISOString()).toBe('2026-09-03T09:00:00.000Z')
  })

  it('stops recurring when maxRuns is reached', () => {
    const now = new Date()
    const next = RecurrenceEngine.calculateNextRun({
      scheduleType: 'INTERVAL',
      scheduleExpr: '60',
      timezone: 'UTC',
      maxRuns: 3,
      totalRunsCompleted: 3,
      endAt: null,
      createdAt: now,
    })

    expect(next).toBeNull()
  })

  it('stops recurring when endAt is exceeded', () => {
    const now = new Date('2026-09-03T10:00:00.000Z')
    const endAt = new Date('2026-09-03T10:30:00.000Z')
    const next = RecurrenceEngine.calculateNextRun(
      {
        scheduleType: 'INTERVAL',
        scheduleExpr: '3600', // 1 hour (would land on 11:00, after endAt)
        timezone: 'UTC',
        maxRuns: null,
        totalRunsCompleted: 0,
        endAt,
        createdAt: now,
      },
      now,
    )

    expect(next).toBeNull()
  })
})

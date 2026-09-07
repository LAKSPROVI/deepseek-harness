import { SimpleCron } from './cron'
import { AutomationTask } from './types'

/**
 * Computes the next execution target given task constraints and reference time.
 *
 * @param task Scheduling parameters of the automation task.
 * @param referenceDate Base timestamp (defaults to current time).
 * @returns Next scheduled instant or null if completed/terminated.
 */
export function calculateNextRun(
  task: Pick<
    AutomationTask,
    | 'scheduleType'
    | 'scheduleExpr'
    | 'timezone'
    | 'maxRuns'
    | 'totalRunsCompleted'
    | 'endAt'
    | 'createdAt'
  >,
  referenceDate: Date = new Date(),
): Date | null {
  // 1. Max runs check
  if (task.maxRuns !== null && task.maxRuns !== undefined && task.totalRunsCompleted >= task.maxRuns) {
    return null
  }

  let nextTarget: Date | null = null

  switch (task.scheduleType) {
    case 'ONCE': {
      const targetDate = new Date(task.scheduleExpr)
      if (isNaN(targetDate.getTime())) {
        throw new Error(`Invalid single schedule date expression: "${task.scheduleExpr}"`)
      }
      if (targetDate.getTime() > referenceDate.getTime() && task.totalRunsCompleted === 0) {
        nextTarget = targetDate
      }
      break
    }

    case 'INTERVAL': {
      const seconds = parseInt(task.scheduleExpr, 10)
      if (isNaN(seconds) || seconds <= 0) {
        throw new Error(`Invalid interval seconds: "${task.scheduleExpr}"`)
      }
      nextTarget = new Date(referenceDate.getTime() + seconds * 1000)
      break
    }

    case 'CRON':
    case 'RRULE': {
      const cron = new SimpleCron(task.scheduleExpr)
      nextTarget = cron.nextRun(referenceDate)
      break
    }

    default:
      throw new Error(`Unsupported scheduleType: ${(task as AutomationTask).scheduleType}`)
  }

  // 2. Expiration check
  if (nextTarget && task.endAt) {
    const expiration = new Date(task.endAt)
    if (nextTarget.getTime() > expiration.getTime()) {
      return null
    }
  }

  return nextTarget
}

export const RecurrenceEngine = {
  calculateNextRun,
}

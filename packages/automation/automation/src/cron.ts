/**
 * Zero-dependency robust standard Cron parser and next-run evaluator.
 * Supports standard 5-part cron syntax in UTC: [minute] [hour] [day of month] [month] [day of week]
 * Supports '*', lists ('1,2,3'), ranges ('1-5'), steps ('* /5', '1-10/2').
 */
export class SimpleCron {
  private minutes: Set<number>
  private hours: Set<number>
  private daysOfMonth: Set<number>
  private months: Set<number>
  private daysOfWeek: Set<number>

  constructor(public readonly expression: string) {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) {
      throw new Error(`Cron expression must have exactly 5 parts: "${expression}"`)
    }

    this.minutes = this.parseField(parts[0], 0, 59)
    this.hours = this.parseField(parts[1], 0, 23)
    this.daysOfMonth = this.parseField(parts[2], 1, 31)
    this.months = this.parseField(parts[3], 1, 12)
    this.daysOfWeek = this.parseField(parts[4], 0, 7) // 0 and 7 are Sunday
    if (this.daysOfWeek.has(7)) {
      this.daysOfWeek.add(0)
      this.daysOfWeek.delete(7)
    }
  }

  private parseField(field: string, min: number, max: number): Set<number> {
    const result = new Set<number>()

    const items = field.split(',')
    for (const item of items) {
      if (item === '*') {
        for (let i = min; i <= max; i++) result.add(i)
        continue
      }

      if (item.includes('/')) {
        const [rangePart, stepStr] = item.split('/')
        const step = parseInt(stepStr, 10)
        if (isNaN(step) || step <= 0) {
          throw new Error(`Invalid step in cron field: ${item}`)
        }

        let start = min
        let end = max
        if (rangePart !== '*' && rangePart !== '') {
          if (rangePart.includes('-')) {
            const [s, e] = rangePart.split('-').map(v => parseInt(v, 10))
            start = s
            end = e
          } else {
            start = parseInt(rangePart, 10)
          }
        }

        for (let i = start; i <= end; i += step) {
          if (i >= min && i <= max) result.add(i)
        }
        continue
      }

      if (item.includes('-')) {
        const [s, e] = item.split('-').map(v => parseInt(v, 10))
        if (isNaN(s) || isNaN(e) || s > e || s < min || e > max) {
          throw new Error(`Invalid range in cron field: ${item}`)
        }
        for (let i = s; i <= e; i++) result.add(i)
        continue
      }

      const num = parseInt(item, 10)
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`Invalid number in cron field: ${item}`)
      }
      result.add(num)
    }

    return result
  }

  /**
   * Finds the next matching date/time strictly after the reference date in UTC.
   */
  public nextRun(referenceDate: Date = new Date()): Date | null {
    // Start from the next full UTC minute
    const current = new Date(referenceDate.getTime())
    current.setUTCSeconds(0, 0)
    current.setUTCMinutes(current.getUTCMinutes() + 1)

    // Limit lookahead to 5 years
    const maxDate = new Date(referenceDate.getTime() + 5 * 365 * 24 * 3600 * 1000)

    while (current.getTime() < maxDate.getTime()) {
      const month = current.getUTCMonth() + 1
      if (!this.months.has(month)) {
        current.setUTCMonth(current.getUTCMonth() + 1, 1)
        current.setUTCHours(0, 0, 0, 0)
        continue
      }

      const dayOfMonth = current.getUTCDate()
      const dayOfWeek = current.getUTCDay()
      if (!this.daysOfMonth.has(dayOfMonth) || !this.daysOfWeek.has(dayOfWeek)) {
        current.setUTCDate(current.getUTCDate() + 1)
        current.setUTCHours(0, 0, 0, 0)
        continue
      }

      const hour = current.getUTCHours()
      if (!this.hours.has(hour)) {
        current.setUTCHours(current.getUTCHours() + 1, 0, 0, 0)
        continue
      }

      const minute = current.getUTCMinutes()
      if (!this.minutes.has(minute)) {
        current.setUTCMinutes(current.getUTCMinutes() + 1, 0, 0)
        continue
      }

      return new Date(current.getTime())
    }

    return null
  }
}

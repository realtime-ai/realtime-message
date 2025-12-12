/**
 * Timer with exponential backoff support
 */
export class Timer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private tries: number = 0

  constructor(
    private callback: () => void,
    private timerCalc: (tries: number) => number
  ) {}

  /**
   * Reset the timer
   */
  reset(): void {
    this.tries = 0
    this.clear()
  }

  /**
   * Schedule the timer with calculated delay
   */
  scheduleTimeout(): void {
    this.clear()
    this.timer = setTimeout(() => {
      this.tries += 1
      this.callback()
    }, this.timerCalc(this.tries + 1))
  }

  /**
   * Clear the timer
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * Get current try count
   */
  getTries(): number {
    return this.tries
  }
}

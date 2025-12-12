import type {
  RealtimePresenceState,
  Presence,
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
} from '@realtime-message/shared'

/**
 * RealtimePresence - Tracks online users and their state in a channel
 */
export class RealtimePresence<T = Record<string, unknown>> {
  private state: RealtimePresenceState<T> = {}
  private pendingDiffs: Array<{
    joins: Record<string, Array<Presence<T>>>
    leaves: Record<string, Array<Presence<T>>>
  }> = []
  private joinRef: string | null = null
  private caller: {
    onJoin?: (payload: RealtimePresenceJoinPayload<T>) => void
    onLeave?: (payload: RealtimePresenceLeavePayload<T>) => void
    onSync?: () => void
  } = {}

  /**
   * Register callback for sync event
   */
  onSync(callback: () => void): this {
    this.caller.onSync = callback
    return this
  }

  /**
   * Register callback for join event
   */
  onJoin(callback: (payload: RealtimePresenceJoinPayload<T>) => void): this {
    this.caller.onJoin = callback
    return this
  }

  /**
   * Register callback for leave event
   */
  onLeave(callback: (payload: RealtimePresenceLeavePayload<T>) => void): this {
    this.caller.onLeave = callback
    return this
  }

  /**
   * Handle presence_state event (full state sync)
   */
  handleState(newState: RealtimePresenceState<T>, newJoinRef: string | null): void {
    this.joinRef = newJoinRef
    this.state = { ...newState }

    // Process any pending diffs
    for (const diff of this.pendingDiffs) {
      this.handleDiff(diff)
    }
    this.pendingDiffs = []

    // Trigger sync callback
    this.caller.onSync?.()
  }

  /**
   * Handle presence_diff event (incremental update)
   */
  handleDiff(diff: {
    joins: Record<string, Array<Presence<T>>>
    leaves: Record<string, Array<Presence<T>>>
  }): void {
    // If we haven't received initial state yet, initialize with empty state
    if (this.joinRef === null) {
      // Auto-initialize with empty state on first diff
      this.joinRef = 'auto'
      this.state = {}
    }

    const { joins, leaves } = diff

    // Process leaves first
    for (const [key, leftPresences] of Object.entries(leaves)) {
      const currentPresences = this.state[key] || []
      const leftRefs = new Set(leftPresences.map((p) => p.presence_ref))
      const remainingPresences = currentPresences.filter(
        (p) => !leftRefs.has(p.presence_ref)
      )

      if (remainingPresences.length === 0) {
        delete this.state[key]
      } else {
        this.state[key] = remainingPresences
      }

      // Trigger leave callback
      if (this.caller.onLeave && leftPresences.length > 0) {
        this.caller.onLeave({
          event: 'leave',
          key,
          currentPresences: remainingPresences,
          leftPresences,
        })
      }
    }

    // Process joins
    for (const [key, newPresences] of Object.entries(joins)) {
      const currentPresences = this.state[key] || []

      // Merge new presences (avoid duplicates by presence_ref)
      const existingRefs = new Set(currentPresences.map((p) => p.presence_ref))
      const uniqueNew = newPresences.filter((p) => !existingRefs.has(p.presence_ref))
      const merged = [...currentPresences, ...uniqueNew]

      this.state[key] = merged

      // Trigger join callback
      if (this.caller.onJoin && uniqueNew.length > 0) {
        this.caller.onJoin({
          event: 'join',
          key,
          currentPresences: merged,
          newPresences: uniqueNew,
        })
      }
    }

    // Trigger sync callback after processing diff
    this.caller.onSync?.()
  }

  /**
   * Get current presence state
   */
  getState(): RealtimePresenceState<T> {
    return { ...this.state }
  }

  /**
   * Get list of presence keys (user identifiers)
   */
  listKeys(): string[] {
    return Object.keys(this.state)
  }

  /**
   * Get presences for a specific key
   */
  getByKey(key: string): Array<Presence<T>> {
    return this.state[key] || []
  }

  /**
   * Reset presence state
   */
  reset(): void {
    this.state = {}
    this.pendingDiffs = []
    this.joinRef = null
  }
}

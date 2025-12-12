import {
  CHANNEL_STATES,
  CHANNEL_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  DEFAULT_TIMEOUT,
  MAX_PUSH_BUFFER_SIZE,
  type ChannelState,
  type RealtimeChannelOptions,
  type RealtimeSubscribeState,
  type JoinPayload,
  type ReplyPayload,
  type BroadcastPayload,
  type PresencePayload,
  type SubscribeCallback,
  type BroadcastCallback,
  type RealtimeChannelSendResponse,
  type RealtimePresenceState,
  type Presence,
  type PresenceSyncCallback,
  type PresenceJoinCallback,
  type PresenceLeaveCallback,
} from '@realtime-message/shared'
import type { RealtimeClient } from './RealtimeClient.js'
import { Push } from './lib/push.js'
import { Timer } from './lib/timer.js'
import { RealtimePresence } from './RealtimePresence.js'

type ReplyCallback = (payload: ReplyPayload) => void

interface BroadcastBinding {
  event: string | null // null means all events
  callback: BroadcastCallback
}

interface PresenceBinding {
  event: 'sync' | 'join' | 'leave'
  callback: PresenceSyncCallback | PresenceJoinCallback | PresenceLeaveCallback
}

/**
 * RealtimeChannel - Manages subscription to a specific channel
 */
export class RealtimeChannel {
  readonly topic: string
  readonly socket: RealtimeClient

  private state: ChannelState = CHANNEL_STATES.closed
  private _joinSeq: string | null = null
  private joinPush: Push | null = null
  private rejoinTimer: Timer
  private pushBuffer: Push[] = []
  private timeout: number
  private replyCallbacks: Map<string, ReplyCallback> = new Map()
  private subscribeCallback: SubscribeCallback | null = null
  private broadcastBindings: BroadcastBinding[] = []
  private presenceBindings: PresenceBinding[] = []
  private presence: RealtimePresence = new RealtimePresence()

  // Channel configuration
  private config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }

  // Track if we were previously joined (for reconnection)
  private wasJoined: boolean = false
  // Track presence meta for re-tracking after reconnect
  private trackedPresenceMeta: Record<string, unknown> | null = null

  constructor(
    topic: string,
    options: RealtimeChannelOptions = {},
    socket: RealtimeClient
  ) {
    this.topic = topic
    this.socket = socket
    this.timeout = DEFAULT_TIMEOUT

    // Parse config
    this.config = {
      broadcast: {
        self: options.config?.broadcast?.self ?? false,
        ack: options.config?.broadcast?.ack ?? false,
      },
      presence: {
        key: options.config?.presence?.key ?? '',
        enabled: options.config?.presence?.enabled ?? false,
      },
    }

    // Setup rejoin timer
    this.rejoinTimer = new Timer(
      () => this.rejoinUntilConnected(),
      socket.reconnectAfterMs
    )
  }

  /**
   * Get join sequence number
   */
  get joinSeq(): string | null {
    return this._joinSeq
  }

  /**
   * Get current channel state
   */
  getState(): ChannelState {
    return this.state
  }

  /**
   * Check if channel is joined
   */
  isJoined(): boolean {
    return this.state === CHANNEL_STATES.joined
  }

  /**
   * Check if channel is joining
   */
  isJoining(): boolean {
    return this.state === CHANNEL_STATES.joining
  }

  /**
   * Check if channel is closed
   */
  isClosed(): boolean {
    return this.state === CHANNEL_STATES.closed
  }

  /**
   * Subscribe to the channel
   */
  subscribe(callback?: SubscribeCallback, timeout?: number): this {
    if (callback) {
      this.subscribeCallback = callback
    }

    if (this.state === CHANNEL_STATES.joined) {
      this.subscribeCallback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
      return this
    }

    if (this.state === CHANNEL_STATES.joining) {
      return this
    }

    this.state = CHANNEL_STATES.joining
    this.rejoinTimer.reset()

    // Async subscription with token
    this.doSubscribe(timeout ?? this.timeout)

    return this
  }

  /**
   * Internal async subscribe implementation
   */
  private async doSubscribe(timeout: number): Promise<void> {
    // Get access token if available
    const accessToken = await this.socket.getAccessToken()

    // Build join payload
    const payload: JoinPayload = {
      config: this.config,
    }

    // Add access token if available
    if (accessToken) {
      payload.access_token = accessToken
    }

    // Create join push
    this.joinPush = new Push(
      this,
      CHANNEL_EVENTS.join,
      payload,
      timeout
    )

    this.joinPush
      .receive('ok', () => {
        this.state = CHANNEL_STATES.joined
        this._joinSeq = this.joinPush?.getSeq() ?? null
        this.wasJoined = true
        console.log(`[Channel ${this.topic}] Joined successfully`)
        this.subscribeCallback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
        this.flushPushBuffer()
        // Re-track presence if we were tracking before disconnect
        this.restorePresenceTracking()
      })
      .receive('error', (response) => {
        this.state = CHANNEL_STATES.errored
        const errorCode = response['code'] as string | undefined
        const errorReason = response['reason'] as string ?? 'Unknown error'
        console.error(`[Channel ${this.topic}] Join error: ${errorReason} (${errorCode ?? 'no code'})`)
        this.subscribeCallback?.(
          REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
          new Error(errorReason)
        )
        // Don't auto-rejoin if authentication failed
        if (!errorCode?.startsWith('AUTH_')) {
          this.rejoinTimer.scheduleTimeout()
        }
      })
      .receive('timeout', () => {
        if (!this.isJoining()) {
          return
        }
        console.warn(`[Channel ${this.topic}] Join timeout`)
        this.state = CHANNEL_STATES.errored
        this.subscribeCallback?.(REALTIME_SUBSCRIBE_STATES.TIMED_OUT)
        this.rejoinTimer.scheduleTimeout()
      })

    this.joinPush.send()
  }

  /**
   * Unsubscribe from the channel
   */
  async unsubscribe(timeout?: number): Promise<'ok' | 'timed out' | 'error'> {
    this.rejoinTimer.reset()
    this.state = CHANNEL_STATES.leaving
    // Clear reconnection state
    this.wasJoined = false
    this.trackedPresenceMeta = null

    return new Promise((resolve) => {
      const leavePush = new Push(
        this,
        CHANNEL_EVENTS.leave,
        {},
        timeout ?? this.timeout
      )

      leavePush
        .receive('ok', () => {
          this.state = CHANNEL_STATES.closed
          console.log(`[Channel ${this.topic}] Left successfully`)
          this.subscribeCallback?.(REALTIME_SUBSCRIBE_STATES.CLOSED)
          resolve('ok')
        })
        .receive('error', () => {
          this.state = CHANNEL_STATES.closed
          resolve('error')
        })
        .receive('timeout', () => {
          this.state = CHANNEL_STATES.closed
          resolve('timed out')
        })

      leavePush.send()
    })
  }

  /**
   * Register a reply callback for seq matching
   */
  onReply(seqEvent: string, callback: ReplyCallback): void {
    this.replyCallbacks.set(seqEvent, callback)
  }

  /**
   * Listen for broadcast or presence events
   * @param type - 'broadcast' or 'presence'
   * @param filter - For broadcast: { event: 'eventName' }, for presence: { event: 'sync' | 'join' | 'leave' }
   * @param callback - Function to call when event is received
   */
  on(
    type: 'broadcast',
    filter: { event?: string },
    callback: BroadcastCallback
  ): this
  on(
    type: 'presence',
    filter: { event: 'sync' },
    callback: PresenceSyncCallback
  ): this
  on(
    type: 'presence',
    filter: { event: 'join' },
    callback: PresenceJoinCallback
  ): this
  on(
    type: 'presence',
    filter: { event: 'leave' },
    callback: PresenceLeaveCallback
  ): this
  on(
    type: 'broadcast' | 'presence',
    filter: { event?: string },
    callback: BroadcastCallback | PresenceSyncCallback | PresenceJoinCallback | PresenceLeaveCallback
  ): this {
    if (type === REALTIME_LISTEN_TYPES.BROADCAST) {
      this.broadcastBindings.push({
        event: filter.event ?? null,
        callback: callback as BroadcastCallback,
      })
    } else if (type === REALTIME_LISTEN_TYPES.PRESENCE) {
      const presenceEvent = filter.event as 'sync' | 'join' | 'leave'
      if (presenceEvent === REALTIME_PRESENCE_LISTEN_EVENTS.SYNC) {
        this.presence.onSync(callback as PresenceSyncCallback)
      } else if (presenceEvent === REALTIME_PRESENCE_LISTEN_EVENTS.JOIN) {
        this.presence.onJoin(callback as PresenceJoinCallback)
      } else if (presenceEvent === REALTIME_PRESENCE_LISTEN_EVENTS.LEAVE) {
        this.presence.onLeave(callback as PresenceLeaveCallback)
      }
    }
    return this
  }

  /**
   * Track presence in the channel
   * @param meta - Metadata to track (e.g., { user_id, status })
   */
  async track(meta: Record<string, unknown> = {}): Promise<RealtimeChannelSendResponse> {
    return new Promise((resolve) => {
      if (!this.isJoined()) {
        resolve({ status: 'error', reason: 'Channel not joined' })
        return
      }

      const presencePayload: PresencePayload = {
        type: 'presence',
        event: 'track',
        payload: { key: this.config.presence.key, meta },
      }

      const push = new Push(this, 'presence', presencePayload, this.timeout)

      push
        .receive('ok', () => {
          // Save for re-tracking after reconnect
          this.trackedPresenceMeta = meta
          resolve({ status: 'ok' })
        })
        .receive('error', (response) => {
          resolve({ status: 'error', reason: response['reason'] as string ?? 'Unknown error' })
        })
        .receive('timeout', () => {
          resolve({ status: 'timeout', reason: 'Timeout' })
        })

      push.send()
    })
  }

  /**
   * Untrack presence from the channel
   */
  async untrack(): Promise<RealtimeChannelSendResponse> {
    return new Promise((resolve) => {
      if (!this.isJoined()) {
        resolve({ status: 'error', reason: 'Channel not joined' })
        return
      }

      const presencePayload: PresencePayload = {
        type: 'presence',
        event: 'untrack',
      }

      const push = new Push(this, 'presence', presencePayload, this.timeout)

      push
        .receive('ok', () => {
          // Clear saved presence meta
          this.trackedPresenceMeta = null
          resolve({ status: 'ok' })
        })
        .receive('error', (response) => {
          resolve({ status: 'error', reason: response['reason'] as string ?? 'Unknown error' })
        })
        .receive('timeout', () => {
          resolve({ status: 'timeout', reason: 'Timeout' })
        })

      push.send()
    })
  }

  /**
   * Get current presence state
   */
  presenceState<T = Record<string, unknown>>(): RealtimePresenceState<T> {
    return this.presence.getState() as RealtimePresenceState<T>
  }

  /**
   * Send a broadcast message to the channel
   */
  send(message: {
    type: 'broadcast'
    event: string
    payload: unknown
  }): Promise<RealtimeChannelSendResponse> {
    return new Promise((resolve) => {
      if (!this.isJoined()) {
        resolve({ status: 'error', reason: 'Channel not joined' })
        return
      }

      const broadcastPayload: BroadcastPayload = {
        type: 'broadcast',
        event: message.event,
        payload: message.payload,
      }

      // If ack is enabled, use push with reply
      if (this.config.broadcast.ack) {
        const push = new Push(
          this,
          CHANNEL_EVENTS.broadcast,
          broadcastPayload,
          this.timeout
        )

        push
          .receive('ok', () => {
            resolve({ status: 'ok' })
          })
          .receive('error', (response) => {
            resolve({ status: 'error', reason: response['reason'] as string ?? 'Unknown error' })
          })
          .receive('timeout', () => {
            resolve({ status: 'timeout', reason: 'Timeout' })
          })

        push.send()
      } else {
        // Fire and forget
        this.socket.push({
          join_seq: this._joinSeq,
          seq: null,
          topic: this.topic,
          event: CHANNEL_EVENTS.broadcast,
          payload: broadcastPayload,
        })
        resolve({ status: 'ok' })
      }
    })
  }

  /**
   * Handle incoming message for this channel
   */
  handleMessage(event: string, payload: unknown, seq: string | null): void {
    // Handle reply messages
    if (event === CHANNEL_EVENTS.reply && seq) {
      const seqEvent = `chan_reply_${seq}`
      const callback = this.replyCallbacks.get(seqEvent)
      if (callback) {
        callback(payload as ReplyPayload)
        this.replyCallbacks.delete(seqEvent)
      }
      return
    }

    // Handle broadcast messages
    if (event === CHANNEL_EVENTS.broadcast) {
      const broadcastPayload = payload as BroadcastPayload
      for (const binding of this.broadcastBindings) {
        // Match all events or specific event
        if (binding.event === null || binding.event === broadcastPayload.event) {
          binding.callback(broadcastPayload)
        }
      }
      return
    }

    // Handle presence_state (full sync)
    if (event === CHANNEL_EVENTS.presence_state) {
      this.presence.handleState(payload as RealtimePresenceState, this._joinSeq)
      return
    }

    // Handle presence_diff (incremental update)
    if (event === CHANNEL_EVENTS.presence_diff) {
      const diff = payload as {
        joins: Record<string, Array<Presence>>
        leaves: Record<string, Array<Presence>>
      }
      this.presence.handleDiff(diff)
      return
    }

    // Unknown event
    console.log(`[Channel ${this.topic}] Received event: ${event}`, payload)
  }

  /**
   * Called when socket connection is established
   */
  onSocketOpen(): void {
    this.rejoinTimer.reset()
    // Auto-rejoin if we were previously joined
    if (this.wasJoined && (this.state === CHANNEL_STATES.errored || this.state === CHANNEL_STATES.closed)) {
      console.log(`[Channel ${this.topic}] Socket reconnected, rejoining...`)
      this.rejoin()
    }
  }

  /**
   * Called when socket connection errors
   */
  onSocketError(): void {
    if (this.isJoining()) {
      this.joinPush?.reset()
    }
    if (this.isJoined() || this.isJoining()) {
      this.state = CHANNEL_STATES.errored
      this.rejoinTimer.scheduleTimeout()
    }
  }

  /**
   * Called when socket connection closes
   */
  onSocketClose(): void {
    this.rejoinTimer.reset()
    this.joinPush?.reset()
    // Keep wasJoined state to rejoin later, but mark as errored for reconnection
    if (this.wasJoined) {
      this.state = CHANNEL_STATES.errored
    } else {
      this.state = CHANNEL_STATES.closed
    }
  }

  // Private methods

  private rejoin(timeout?: number): void {
    if (this.isClosed()) {
      return
    }
    this.state = CHANNEL_STATES.joining
    // Re-subscribe with fresh token
    this.doSubscribe(timeout ?? this.timeout)
  }

  private rejoinUntilConnected(): void {
    if (!this.socket.isConnected()) {
      this.rejoinTimer.scheduleTimeout()
      return
    }
    this.rejoin()
  }

  private flushPushBuffer(): void {
    if (!this.isJoined()) {
      return
    }

    while (this.pushBuffer.length > 0) {
      const push = this.pushBuffer.shift()
      push?.send()
    }
  }

  /**
   * Restore presence tracking after reconnection
   */
  private restorePresenceTracking(): void {
    if (this.trackedPresenceMeta !== null) {
      console.log(`[Channel ${this.topic}] Restoring presence tracking...`)
      // Re-track with saved meta
      this.track(this.trackedPresenceMeta).then((result) => {
        if (result.status === 'ok') {
          console.log(`[Channel ${this.topic}] Presence restored`)
        } else {
          console.warn(`[Channel ${this.topic}] Failed to restore presence: ${result.reason}`)
        }
      })
    }
  }

  /**
   * Push a message to the buffer (for use when not yet joined)
   */
  pushToBuffer(push: Push): void {
    if (this.pushBuffer.length >= MAX_PUSH_BUFFER_SIZE) {
      // Remove oldest
      this.pushBuffer.shift()
    }
    this.pushBuffer.push(push)
  }
}

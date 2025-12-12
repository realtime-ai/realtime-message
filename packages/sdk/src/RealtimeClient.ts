import {
  SOCKET_STATES,
  CONNECTION_STATE,
  CHANNEL_EVENTS,
  SYSTEM_TOPIC,
  DEFAULT_TIMEOUT,
  DEFAULT_HEARTBEAT_INTERVAL,
  WS_CLOSE_NORMAL,
  type ConnectionState,
  type RealtimeClientOptions,
  type RealtimeChannelOptions,
  type HeartbeatStatus,
  type RawMessage,
  type Message,
  type WebSocketLike,
  type LogLevel,
  type RealtimeRemoveChannelResponse,
} from '@realtime-message/shared'
import { RealtimeChannel } from './RealtimeChannel.js'

/**
 * RealtimeClient - WebSocket connection manager
 */
export class RealtimeClient {
  private endPoint: string
  private options: Required<
    Pick<RealtimeClientOptions, 'timeout' | 'heartbeatIntervalMs' | 'logLevel'>
  > &
    RealtimeClientOptions
  private conn: WebSocketLike | null = null
  private seq: number = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pendingHeartbeatSeq: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTries: number = 0
  private sendBuffer: Array<() => void> = []
  private closeWasClean: boolean = false

  // Channel management
  private channels: RealtimeChannel[] = []

  // Authentication
  private accessTokenFn: (() => Promise<string | null>) | null = null
  private staticToken: string | null = null

  // Callbacks
  private heartbeatCallback: ((status: HeartbeatStatus) => void) | null = null
  private errorCallbacks: Array<(error: Error) => void> = []
  private openCallbacks: Array<() => void> = []
  private closeCallbacks: Array<(event: CloseEvent) => void> = []

  constructor(endPoint: string, options: RealtimeClientOptions = {}) {
    this.endPoint = endPoint
    this.options = {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL,
      logLevel: options.logLevel ?? 'error',
      ...options,
    }
    this.heartbeatCallback = options.heartbeatCallback ?? null
    this.accessTokenFn = options.accessToken ?? null
    this.staticToken = options.token ?? null
  }

  /**
   * Establish WebSocket connection
   */
  connect(): void {
    if (this.conn) {
      return
    }

    this.log('info', `Connecting to ${this.endPoint}`)
    this.closeWasClean = false

    try {
      // Use custom transport or native WebSocket
      const WebSocketImpl = this.options.transport ?? WebSocket
      this.conn = new WebSocketImpl(this.endPoint)

      this.conn.onopen = () => {
        this.log('info', 'Connected')
        this.reconnectTries = 0
        this.flushSendBuffer()
        this.startHeartbeat()
        // Notify channels
        this.channels.forEach((ch) => ch.onSocketOpen())
        this.openCallbacks.forEach((cb) => cb())
      }

      this.conn.onclose = (event) => {
        this.log('info', `Disconnected. Code: ${event.code}, Reason: ${event.reason}`)
        this.conn = null
        this.stopHeartbeat()
        // Notify channels
        this.channels.forEach((ch) => ch.onSocketClose())
        this.closeCallbacks.forEach((cb) => cb(event))

        // Auto reconnect if not clean close
        if (!this.closeWasClean) {
          this.scheduleReconnect()
        }
      }

      this.conn.onerror = (event) => {
        this.log('error', 'Connection error', event)
        // Notify channels
        this.channels.forEach((ch) => ch.onSocketError())
        const error = new Error('WebSocket error')
        this.errorCallbacks.forEach((cb) => cb(error))
      }

      this.conn.onmessage = (event) => {
        this.handleMessage(event.data as string)
      }
    } catch (error) {
      this.log('error', 'Failed to connect', error)
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(code: number = WS_CLOSE_NORMAL, reason: string = 'client disconnect'): void {
    this.closeWasClean = true
    this.clearReconnectTimer()
    this.stopHeartbeat()

    if (this.conn) {
      this.conn.close(code, reason)
      this.conn = null
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.conn?.readyState === SOCKET_STATES.open
  }

  /**
   * Check if connecting
   */
  isConnecting(): boolean {
    return this.conn?.readyState === SOCKET_STATES.connecting
  }

  /**
   * Get current connection state
   */
  connectionState(): ConnectionState {
    if (!this.conn) {
      return CONNECTION_STATE.Closed
    }
    switch (this.conn.readyState) {
      case SOCKET_STATES.connecting:
        return CONNECTION_STATE.Connecting
      case SOCKET_STATES.open:
        return CONNECTION_STATE.Open
      case SOCKET_STATES.closing:
        return CONNECTION_STATE.Closing
      default:
        return CONNECTION_STATE.Closed
    }
  }

  /**
   * Create or get a channel
   */
  channel(topic: string, options: RealtimeChannelOptions = {}): RealtimeChannel {
    // Check if channel already exists
    const existing = this.channels.find((ch) => ch.topic === topic)
    if (existing) {
      return existing
    }

    // Create new channel
    const channel = new RealtimeChannel(topic, options, this)
    this.channels.push(channel)
    return channel
  }

  /**
   * Remove a channel
   */
  async removeChannel(channel: RealtimeChannel): Promise<RealtimeRemoveChannelResponse> {
    // Unsubscribe if joined
    if (channel.isJoined() || channel.isJoining()) {
      const result = await channel.unsubscribe()
      if (result !== 'ok') {
        return { status: result === 'timed out' ? 'timed out' : 'error' }
      }
    }

    // Remove from channels list
    const index = this.channels.indexOf(channel)
    if (index > -1) {
      this.channels.splice(index, 1)
    }

    return { status: 'ok' }
  }

  /**
   * Remove all channels
   */
  async removeAllChannels(): Promise<RealtimeRemoveChannelResponse[]> {
    const results: RealtimeRemoveChannelResponse[] = []
    for (const channel of [...this.channels]) {
      const result = await this.removeChannel(channel)
      results.push(result)
    }
    return results
  }

  /**
   * Get all channels
   */
  getChannels(): RealtimeChannel[] {
    return [...this.channels]
  }

  /**
   * Register heartbeat status callback
   */
  onHeartbeat(callback: (status: HeartbeatStatus) => void): void {
    this.heartbeatCallback = callback
  }

  /**
   * Register connection open callback
   */
  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback)
  }

  /**
   * Register connection close callback
   */
  onClose(callback: (event: CloseEvent) => void): void {
    this.closeCallbacks.push(callback)
  }

  /**
   * Register error callback
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback)
  }

  /**
   * Set authentication token or callback
   * @param token - Static token string or async function that returns a token
   */
  setAuth(token: string | (() => Promise<string | null>)): void {
    if (typeof token === 'string') {
      this.staticToken = token
      this.accessTokenFn = null
    } else {
      this.accessTokenFn = token
      this.staticToken = null
    }
  }

  /**
   * Get current access token
   * Returns the token from accessToken callback or static token
   */
  async getAccessToken(): Promise<string | null> {
    if (this.accessTokenFn) {
      try {
        return await this.accessTokenFn()
      } catch (error) {
        this.log('error', 'Failed to get access token', error)
        return null
      }
    }
    return this.staticToken
  }

  /**
   * Generate unique seq
   */
  makeSeq(): string {
    this.seq += 1
    return this.seq.toString()
  }

  /**
   * Reconnect interval calculator (exposed for channels)
   */
  reconnectAfterMs = (tries: number): number => {
    if (this.options.reconnectAfterMs) {
      return this.options.reconnectAfterMs(tries)
    }
    return this.defaultReconnectAfterMs(tries)
  }

  /**
   * Send raw message
   */
  push(message: Message): void {
    const send = () => {
      const raw: RawMessage = [
        message.join_seq,
        message.seq,
        message.topic,
        message.event,
        message.payload,
      ]
      this.conn?.send(JSON.stringify(raw))
    }

    if (this.isConnected()) {
      send()
    } else {
      this.sendBuffer.push(send)
    }
  }

  // Private methods

  private log(level: LogLevel, msg: string, data?: unknown): void {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.options.logLevel)
    const msgLevelIndex = levels.indexOf(level)

    if (msgLevelIndex >= currentLevelIndex) {
      if (this.options.logger) {
        this.options.logger(level, msg, data)
      } else {
        const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
        if (data !== undefined) {
          logFn(`[RealtimeClient] ${msg}`, data)
        } else {
          logFn(`[RealtimeClient] ${msg}`)
        }
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const raw = JSON.parse(data) as RawMessage
      if (!Array.isArray(raw) || raw.length !== 5) {
        this.log('warn', 'Invalid message format', data)
        return
      }

      const message: Message = {
        join_seq: raw[0],
        seq: raw[1],
        topic: raw[2],
        event: raw[3],
        payload: raw[4],
      }

      this.log('debug', `Received: ${message.event} on ${message.topic}`, message.payload)

      // Handle heartbeat reply
      if (
        message.topic === SYSTEM_TOPIC &&
        message.event === CHANNEL_EVENTS.reply &&
        message.seq === this.pendingHeartbeatSeq
      ) {
        this.pendingHeartbeatSeq = null
        this.heartbeatCallback?.('ok')
        return
      }

      // Route message to appropriate channel
      const channel = this.channels.find((ch) => ch.topic === message.topic)
      if (channel) {
        channel.handleMessage(message.event, message.payload, message.seq)
      }
    } catch (error) {
      this.log('error', 'Failed to parse message', error)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, this.options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.pendingHeartbeatSeq = null
  }

  private sendHeartbeat(): void {
    if (!this.isConnected()) {
      this.heartbeatCallback?.('disconnected')
      return
    }

    // Check if previous heartbeat was not acknowledged
    if (this.pendingHeartbeatSeq !== null) {
      this.log('warn', 'Heartbeat timeout - previous heartbeat not acknowledged')
      this.heartbeatCallback?.('timeout')
      // Close connection to trigger reconnect
      this.conn?.close(WS_CLOSE_NORMAL, 'heartbeat timeout')
      return
    }

    this.pendingHeartbeatSeq = this.makeSeq()
    this.heartbeatCallback?.('sent')

    this.push({
      join_seq: null,
      seq: this.pendingHeartbeatSeq,
      topic: SYSTEM_TOPIC,
      event: CHANNEL_EVENTS.heartbeat,
      payload: {},
    })
  }

  private flushSendBuffer(): void {
    while (this.sendBuffer.length > 0 && this.isConnected()) {
      const send = this.sendBuffer.shift()
      send?.()
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()

    const delay = this.reconnectAfterMs(this.reconnectTries + 1)

    this.log('info', `Reconnecting in ${delay}ms (attempt ${this.reconnectTries + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTries += 1
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private defaultReconnectAfterMs(tries: number): number {
    const intervals = [1000, 2000, 5000, 10000]
    return intervals[tries - 1] ?? 10000
  }
}

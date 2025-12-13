import type {
  ChannelState,
  ConnectionState,
  RealtimeSubscribeState,
} from './constants.js'

/**
 * WebSocket message format: [join_seq, seq, topic, event, payload]
 */
export type RawMessage = [
  join_seq: string | null,
  seq: string | null,
  topic: string,
  event: string,
  payload: unknown,
]

/**
 * Parsed message structure
 */
export interface Message {
  join_seq: string | null
  seq: string | null
  topic: string
  event: string
  payload: unknown
}

/**
 * RealtimeClient configuration options
 */
export interface RealtimeClientOptions {
  /**
   * Custom WebSocket implementation (for Node.js < 22)
   */
  transport?: WebSocketLikeConstructor

  /**
   * Default timeout in milliseconds
   * @default 10000
   */
  timeout?: number

  /**
   * Heartbeat interval in milliseconds
   * @default 25000
   */
  heartbeatIntervalMs?: number

  /**
   * Callback for heartbeat status updates
   */
  heartbeatCallback?: (status: HeartbeatStatus) => void

  /**
   * Async function to get JWT access token (recommended)
   */
  accessToken?: () => Promise<string | null>

  /**
   * Static JWT token (for short-term use)
   */
  token?: string

  /**
   * Custom logger function
   */
  logger?: (level: LogLevel, msg: string, data?: unknown) => void

  /**
   * Log level
   * @default 'error'
   */
  logLevel?: LogLevel

  /**
   * Custom reconnect interval calculation
   */
  reconnectAfterMs?: (tries: number) => number

  /**
   * Custom fetch implementation
   */
  fetch?: typeof fetch

  /**
   * Use Web Worker for heartbeat
   */
  worker?: boolean

  /**
   * Web Worker script URL
   */
  workerUrl?: string
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type HeartbeatStatus = 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected'

/**
 * WebSocket-like interface for custom implementations
 */
export interface WebSocketLike {
  readonly readyState: number
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
  send(data: string | ArrayBuffer): void
  close(code?: number, reason?: string): void
  onopen: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
}

export interface WebSocketLikeConstructor {
  new (url: string): WebSocketLike
}

/**
 * Channel configuration options
 */
export interface RealtimeChannelOptions {
  config?: {
    /**
     * Broadcast configuration
     */
    broadcast?: {
      /**
       * Receive own broadcast messages
       * @default false
       */
      self?: boolean

      /**
       * Require server acknowledgment
       * @default false
       */
      ack?: boolean
    }

    /**
     * Presence configuration
     */
    presence?: {
      /**
       * Presence key identifier
       * @default ''
       */
      key?: string

      /**
       * Enable presence tracking
       * @default false
       */
      enabled?: boolean
    }
  }
}

/**
 * Channel join payload
 */
export interface JoinPayload {
  config: {
    broadcast: {
      self: boolean
      ack: boolean
    }
    presence: {
      key: string
      enabled: boolean
    }
  }
  access_token?: string
}

/**
 * Reply payload from server
 */
export interface ReplyPayload {
  status: 'ok' | 'error'
  response: {
    reason?: string
    code?: string
    [key: string]: unknown
  }
}

/**
 * Broadcast message payload
 */
export interface BroadcastPayload {
  type: 'broadcast'
  event: string
  payload: unknown
}

/**
 * Presence payload
 */
export interface PresencePayload {
  type: 'presence'
  event: 'track' | 'untrack'
  payload?: unknown
}

/**
 * Presence state structure
 */
export interface RealtimePresenceState<T = Record<string, unknown>> {
  [key: string]: Array<Presence<T>>
}

export interface Presence<T = Record<string, unknown>> {
  presence_ref: string
  meta: T
}

/**
 * Presence join payload
 */
export interface RealtimePresenceJoinPayload<T = Record<string, unknown>> {
  event: 'join'
  key: string
  currentPresences: Array<Presence<T>>
  newPresences: Array<Presence<T>>
}

/**
 * Presence leave payload
 */
export interface RealtimePresenceLeavePayload<T = Record<string, unknown>> {
  event: 'leave'
  key: string
  currentPresences: Array<Presence<T>>
  leftPresences: Array<Presence<T>>
}

/**
 * Channel send response
 */
export interface RealtimeChannelSendResponse {
  status: 'ok' | 'error' | 'timeout'
  code?: string
  reason?: string
}

/**
 * Remove channel response
 */
export interface RealtimeRemoveChannelResponse {
  status: 'ok' | 'error' | 'timed out'
}

/**
 * Subscribe callback
 */
export type SubscribeCallback = (
  status: RealtimeSubscribeState,
  err?: Error
) => void

/**
 * Event callback for broadcast
 */
export type BroadcastCallback<T = unknown> = (payload: {
  type: 'broadcast'
  event: string
  payload: T
  meta?: {
    id: string
    replayed?: boolean
  }
}) => void

/**
 * Event callback for presence sync
 */
export type PresenceSyncCallback = () => void

/**
 * Event callback for presence join
 */
export type PresenceJoinCallback<T = Record<string, unknown>> = (
  payload: RealtimePresenceJoinPayload<T>
) => void

/**
 * Event callback for presence leave
 */
export type PresenceLeaveCallback<T = Record<string, unknown>> = (
  payload: RealtimePresenceLeavePayload<T>
) => void

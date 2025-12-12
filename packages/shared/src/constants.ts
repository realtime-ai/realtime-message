/**
 * WebSocket ready states
 */
export const SOCKET_STATES = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
} as const

/**
 * Connection state strings for public API
 */
export const CONNECTION_STATE = {
  Connecting: 'connecting',
  Open: 'open',
  Closing: 'closing',
  Closed: 'closed',
} as const

export type ConnectionState = (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE]

/**
 * Channel states
 */
export const CHANNEL_STATES = {
  closed: 'closed',
  errored: 'errored',
  joined: 'joined',
  joining: 'joining',
  leaving: 'leaving',
} as const

export type ChannelState = (typeof CHANNEL_STATES)[keyof typeof CHANNEL_STATES]

/**
 * Channel events (protocol level)
 */
export const CHANNEL_EVENTS = {
  close: 'chan:close',
  error: 'chan:error',
  join: 'chan:join',
  reply: 'chan:reply',
  leave: 'chan:leave',
  access_token: 'access_token',
  heartbeat: 'heartbeat',
  broadcast: 'broadcast',
  presence_state: 'presence_state',
  presence_diff: 'presence_diff',
} as const

export type ChannelEvent = (typeof CHANNEL_EVENTS)[keyof typeof CHANNEL_EVENTS]

/**
 * Realtime listen types
 */
export const REALTIME_LISTEN_TYPES = {
  BROADCAST: 'broadcast',
  PRESENCE: 'presence',
  SYSTEM: 'system',
} as const

export type RealtimeListenType = (typeof REALTIME_LISTEN_TYPES)[keyof typeof REALTIME_LISTEN_TYPES]

/**
 * Presence events
 */
export const REALTIME_PRESENCE_LISTEN_EVENTS = {
  SYNC: 'sync',
  JOIN: 'join',
  LEAVE: 'leave',
} as const

export type RealtimePresenceListenEvent =
  (typeof REALTIME_PRESENCE_LISTEN_EVENTS)[keyof typeof REALTIME_PRESENCE_LISTEN_EVENTS]

/**
 * Subscribe states
 */
export const REALTIME_SUBSCRIBE_STATES = {
  SUBSCRIBED: 'SUBSCRIBED',
  TIMED_OUT: 'TIMED_OUT',
  CLOSED: 'CLOSED',
  CHANNEL_ERROR: 'CHANNEL_ERROR',
} as const

export type RealtimeSubscribeState =
  (typeof REALTIME_SUBSCRIBE_STATES)[keyof typeof REALTIME_SUBSCRIBE_STATES]

/**
 * Default configuration values
 */
export const DEFAULT_TIMEOUT = 10_000 // 10 seconds
export const DEFAULT_HEARTBEAT_INTERVAL = 25_000 // 25 seconds
export const MAX_PUSH_BUFFER_SIZE = 100
export const MAX_SEND_BUFFER_SIZE = 1000
export const WS_CLOSE_NORMAL = 1000

/**
 * Protocol constants
 */
export const PROTOCOL_VERSION = '1.0.0'
export const SYSTEM_TOPIC = '$system'

/**
 * Limits
 */
export const MAX_MESSAGE_SIZE = 102_400 // 100 KB
export const MAX_PRESENCE_SIZE = 10_240 // 10 KB
export const MAX_TOPIC_LENGTH = 255
export const MAX_EVENT_LENGTH = 128
export const MAX_CHANNELS_PER_CONNECTION = 100
export const MAX_CONNECTIONS_PER_CHANNEL = 10_000
export const MAX_PRESENCE_PER_CHANNEL = 1000

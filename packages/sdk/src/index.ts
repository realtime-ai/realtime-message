export { RealtimeClient } from './RealtimeClient.js'
export { RealtimeChannel } from './RealtimeChannel.js'
export { RealtimePresence } from './RealtimePresence.js'

// Re-export types from shared
export type {
  // Client and Channel options
  RealtimeClientOptions,
  RealtimeChannelOptions,
  HeartbeatStatus,
  ConnectionState,
  ChannelState,
  RealtimeSubscribeState,
  LogLevel,

  // Message types
  Message,
  RawMessage,
  ReplyPayload,
  JoinPayload,

  // Broadcast types
  RealtimeChannelSendResponse,
  BroadcastPayload,
  BroadcastCallback,

  // Presence types
  RealtimePresenceState,
  Presence,
  PresencePayload,
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
  PresenceSyncCallback,
  PresenceJoinCallback,
  PresenceLeaveCallback,

  // Remove channel response
  RealtimeRemoveChannelResponse,
  SubscribeCallback,

  // Statistics types
  RttStatistics,
  ConnectionStatistics,
  HeartbeatStatistics,
  MessageStatistics,
  RealtimeStatistics,
} from '@realtime-message/shared'

// Re-export constants
export {
  // Connection states
  CONNECTION_STATE,
  SOCKET_STATES,

  // Channel states and events
  CHANNEL_STATES,
  CHANNEL_EVENTS,

  // Subscribe states
  REALTIME_SUBSCRIBE_STATES,

  // Listen types
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,

  // Default values
  DEFAULT_TIMEOUT,
  DEFAULT_HEARTBEAT_INTERVAL,
  MAX_MESSAGE_SIZE,

  // Protocol
  PROTOCOL_VERSION,
  SYSTEM_TOPIC,
} from '@realtime-message/shared'

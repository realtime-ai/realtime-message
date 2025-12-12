// Serializer
export { encode, decode, createReply } from './serializer.js'

// Constants
export {
  SOCKET_STATES,
  CONNECTION_STATE,
  CHANNEL_STATES,
  CHANNEL_EVENTS,
  REALTIME_LISTEN_TYPES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  DEFAULT_TIMEOUT,
  DEFAULT_HEARTBEAT_INTERVAL,
  MAX_PUSH_BUFFER_SIZE,
  MAX_SEND_BUFFER_SIZE,
  WS_CLOSE_NORMAL,
  PROTOCOL_VERSION,
  SYSTEM_TOPIC,
  MAX_MESSAGE_SIZE,
  MAX_PRESENCE_SIZE,
  MAX_TOPIC_LENGTH,
  MAX_EVENT_LENGTH,
  MAX_CHANNELS_PER_CONNECTION,
  MAX_CONNECTIONS_PER_CHANNEL,
  MAX_PRESENCE_PER_CHANNEL,
} from './constants.js'

export type {
  ConnectionState,
  ChannelState,
  ChannelEvent,
  RealtimeListenType,
  RealtimePresenceListenEvent,
  RealtimeSubscribeState,
} from './constants.js'

// Types
export type {
  RawMessage,
  Message,
  RealtimeClientOptions,
  LogLevel,
  HeartbeatStatus,
  WebSocketLike,
  WebSocketLikeConstructor,
  RealtimeChannelOptions,
  JoinPayload,
  ReplyPayload,
  BroadcastPayload,
  PresencePayload,
  RealtimePresenceState,
  Presence,
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
  RealtimeChannelSendResponse,
  RealtimeRemoveChannelResponse,
  SubscribeCallback,
  BroadcastCallback,
  PresenceSyncCallback,
  PresenceJoinCallback,
  PresenceLeaveCallback,
} from './types.js'

export interface Env {
  REALTIME_CHANNEL: DurableObjectNamespace
  REALTIME_GATEWAY: DurableObjectNamespace
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  JWT_SECRET?: string
}

export interface ClientInfo {
  clientId: string
  joinSeq: string
  topics: Set<string>
  config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }
}

export interface ChannelMember {
  clientId: string
  ws: WebSocket
  joinSeq: string
  config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }
}

export interface PresenceState {
  [key: string]: unknown
}

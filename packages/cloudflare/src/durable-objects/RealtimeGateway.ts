/**
 * RealtimeGateway - WebSocket Gateway Durable Object
 *
 * This Durable Object acts as a gateway for WebSocket connections,
 * handling multiple channel subscriptions over a single WebSocket connection.
 * This provides compatibility with the SDK which expects a single WebSocket
 * connection that can join/leave multiple channels.
 */
import {
  encode,
  decode,
  createReply,
  CHANNEL_EVENTS,
  SYSTEM_TOPIC,
  type Message,
  type JoinPayload,
  type BroadcastPayload,
  type PresencePayload,
  type ReplyPayload,
} from '@realtime-message/shared'
import type { Env, ChannelMember, PresenceState } from '../types.js'

interface WebSocketWithInfo extends WebSocket {
  clientId?: string
}

interface ChannelSubscription {
  topic: string
  joinSeq: string
  config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }
}

interface ClientState {
  clientId: string
  ws: WebSocketWithInfo
  channels: Map<string, ChannelSubscription>
}

/**
 * Channel state managed by the gateway
 */
interface ChannelState {
  topic: string
  members: Map<string, ChannelMember>
  presence: Map<string, PresenceState>
}

export class RealtimeGateway implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private clients: Map<string, ClientState> = new Map()
  private channels: Map<string, ChannelState> = new Map()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    return this.handleWebSocketUpgrade(request)
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID()

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocketWithInfo]

    // Store client info on WebSocket
    server.clientId = clientId

    // Accept the WebSocket with hibernation support
    this.state.acceptWebSocket(server)

    // Initialize client state
    this.clients.set(clientId, {
      clientId,
      ws: server,
      channels: new Map(),
    })

    console.log(`[RealtimeGateway] Client ${clientId} connected`)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(ws: WebSocketWithInfo, message: ArrayBuffer | string): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const decoded = decode(data)

      if (!decoded) {
        console.error('[RealtimeGateway] Invalid message format')
        return
      }

      const { join_seq, seq, topic, event, payload } = decoded
      const clientId = ws.clientId

      if (!clientId) {
        console.error('[RealtimeGateway] No clientId on WebSocket')
        return
      }

      // Handle system heartbeat
      if (topic === SYSTEM_TOPIC && event === CHANNEL_EVENTS.heartbeat) {
        this.handleHeartbeat(ws, seq)
        return
      }

      // Handle channel events
      switch (event) {
        case CHANNEL_EVENTS.join:
          await this.handleJoin(ws, clientId, join_seq, seq, topic, payload as JoinPayload)
          break
        case CHANNEL_EVENTS.leave:
          await this.handleLeave(ws, clientId, seq, topic)
          break
        case CHANNEL_EVENTS.broadcast:
          await this.handleBroadcast(ws, clientId, seq, topic, payload as BroadcastPayload)
          break
        case 'presence':
          await this.handlePresence(ws, clientId, seq, topic, payload as PresencePayload)
          break
        default:
          console.log(`[RealtimeGateway] Unknown event: ${event}`)
      }
    } catch (error) {
      console.error('[RealtimeGateway] Error processing message:', error)
    }
  }

  async webSocketClose(ws: WebSocketWithInfo, code: number, reason: string): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    console.log(`[RealtimeGateway] Client ${clientId} disconnected: ${code} ${reason}`)

    const clientState = this.clients.get(clientId)
    if (clientState) {
      // Leave all channels and cleanup presence
      for (const [topic, subscription] of clientState.channels) {
        this.leaveChannel(clientId, topic, subscription)
      }
      this.clients.delete(clientId)
    }
  }

  async webSocketError(ws: WebSocketWithInfo, error: unknown): Promise<void> {
    console.error('[RealtimeGateway] WebSocket error:', error)
    const clientId = ws.clientId
    if (clientId) {
      const clientState = this.clients.get(clientId)
      if (clientState) {
        for (const [topic, subscription] of clientState.channels) {
          this.leaveChannel(clientId, topic, subscription)
        }
        this.clients.delete(clientId)
      }
    }
  }

  private handleHeartbeat(ws: WebSocketWithInfo, seq: string | null): void {
    const reply = createReply(seq, SYSTEM_TOPIC, 'ok', {})
    ws.send(encode(reply))
  }

  private getOrCreateChannel(topic: string): ChannelState {
    let channel = this.channels.get(topic)
    if (!channel) {
      channel = {
        topic,
        members: new Map(),
        presence: new Map(),
      }
      this.channels.set(topic, channel)
    }
    return channel
  }

  private async handleJoin(
    ws: WebSocketWithInfo,
    clientId: string,
    joinSeq: string | null,
    seq: string | null,
    topic: string,
    payload: JoinPayload
  ): Promise<void> {
    const clientState = this.clients.get(clientId)
    if (!clientState) return

    // Check if already joined this channel
    if (clientState.channels.has(topic)) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Already joined this channel',
      })
      ws.send(encode(reply))
      return
    }

    // Create subscription
    // Note: presence is enabled if a key is provided, regardless of 'enabled' field
    const presenceKey = payload.config?.presence?.key ?? ''
    const subscription: ChannelSubscription = {
      topic,
      joinSeq: joinSeq || '0',
      config: {
        broadcast: {
          self: payload.config?.broadcast?.self ?? false,
          ack: payload.config?.broadcast?.ack ?? false,
        },
        presence: {
          key: presenceKey,
          enabled: !!presenceKey, // Enable presence if key is provided
        },
      },
    }

    // Add to client's channels
    clientState.channels.set(topic, subscription)

    // Get or create channel state
    const channel = this.getOrCreateChannel(topic)

    // Add member to channel
    const member: ChannelMember = {
      clientId,
      ws,
      joinSeq: subscription.joinSeq,
      config: subscription.config,
    }
    channel.members.set(clientId, member)

    console.log(`[RealtimeGateway] ${clientId} joined ${topic}. Members: ${channel.members.size}`)

    // Send join reply
    const reply = createReply(seq, topic, 'ok', {
      presence_ref: subscription.config.presence.key || clientId,
    })
    ws.send(encode(reply))

    // Send current presence state if presence is enabled
    if (subscription.config.presence.enabled) {
      // Format: { [key]: [{ presence_ref, meta }] }
      const presenceState: Record<string, Array<{ presence_ref: string; meta: PresenceState }>> = {}
      for (const [key, state] of channel.presence) {
        presenceState[key] = [{ presence_ref: key, meta: state }]
      }

      const stateMessage: Message = {
        join_seq: joinSeq,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_state,
        payload: presenceState,
      }
      ws.send(encode(stateMessage))
    }
  }

  private async handleLeave(
    ws: WebSocketWithInfo,
    clientId: string,
    seq: string | null,
    topic: string
  ): Promise<void> {
    const clientState = this.clients.get(clientId)
    if (!clientState) return

    const subscription = clientState.channels.get(topic)
    if (!subscription) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel',
      })
      ws.send(encode(reply))
      return
    }

    this.leaveChannel(clientId, topic, subscription)
    clientState.channels.delete(topic)

    // Send leave reply
    const reply = createReply(seq, topic, 'ok', {})
    ws.send(encode(reply))
  }

  private leaveChannel(clientId: string, topic: string, subscription: ChannelSubscription): void {
    const channel = this.channels.get(topic)
    if (!channel) return

    // Handle presence leave
    if (subscription.config.presence.enabled && subscription.config.presence.key) {
      const presenceKey = subscription.config.presence.key
      channel.presence.delete(presenceKey)

      // Broadcast presence leave to other members
      // Format: { joins: {}, leaves: { [key]: [{ presence_ref }] } }
      const leaveMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: {
          joins: {},
          leaves: {
            [presenceKey]: [{ presence_ref: presenceKey }],
          },
        },
      }
      this.broadcastToChannel(channel, encode(leaveMessage), clientId)
    }

    channel.members.delete(clientId)
    console.log(`[RealtimeGateway] ${clientId} left ${topic}. Members: ${channel.members.size}`)

    // Clean up empty channel
    if (channel.members.size === 0) {
      this.channels.delete(topic)
    }
  }

  private async handleBroadcast(
    ws: WebSocketWithInfo,
    clientId: string,
    seq: string | null,
    topic: string,
    payload: BroadcastPayload
  ): Promise<void> {
    const clientState = this.clients.get(clientId)
    if (!clientState) return

    const subscription = clientState.channels.get(topic)
    if (!subscription) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel',
      })
      ws.send(encode(reply))
      return
    }

    const channel = this.channels.get(topic)
    if (!channel) return

    // Create broadcast message
    const broadcastMessage: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.broadcast,
      payload,
    }
    const encoded = encode(broadcastMessage)

    // Broadcast to all members (optionally including self)
    const excludeClientId = subscription.config.broadcast.self ? undefined : clientId
    this.broadcastToChannel(channel, encoded, excludeClientId)

    // Send ack if requested
    if (subscription.config.broadcast.ack) {
      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    }
  }

  private async handlePresence(
    ws: WebSocketWithInfo,
    clientId: string,
    seq: string | null,
    topic: string,
    payload: PresencePayload
  ): Promise<void> {
    const clientState = this.clients.get(clientId)
    if (!clientState) return

    const subscription = clientState.channels.get(topic)
    if (!subscription || !subscription.config.presence.enabled) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel or presence not enabled',
      })
      ws.send(encode(reply))
      return
    }

    const channel = this.channels.get(topic)
    if (!channel) return

    const presenceKey = subscription.config.presence.key || clientId

    if (payload.event === 'track') {
      // Track presence
      const meta = (payload.payload as { meta?: PresenceState })?.meta || {}
      channel.presence.set(presenceKey, meta)

      // Broadcast presence join to other members
      // Format: { joins: { [key]: [{ presence_ref, meta }] }, leaves: {} }
      const joinMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: {
          joins: {
            [presenceKey]: [{ presence_ref: presenceKey, meta }],
          },
          leaves: {},
        },
      }
      this.broadcastToChannel(channel, encode(joinMessage), clientId)

      // Send success reply
      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    } else if (payload.event === 'untrack') {
      // Untrack presence
      channel.presence.delete(presenceKey)

      // Broadcast presence leave
      // Format: { joins: {}, leaves: { [key]: [{ presence_ref }] } }
      const leaveMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: {
          joins: {},
          leaves: {
            [presenceKey]: [{ presence_ref: presenceKey }],
          },
        },
      }
      this.broadcastToChannel(channel, encode(leaveMessage), clientId)

      // Send success reply
      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    }
  }

  private broadcastToChannel(channel: ChannelState, message: string, excludeClientId?: string): void {
    for (const [memberId, member] of channel.members) {
      if (excludeClientId && memberId === excludeClientId) {
        continue
      }
      try {
        member.ws.send(message)
      } catch (error) {
        console.error(`[RealtimeGateway] Error sending to ${memberId}:`, error)
      }
    }
  }
}

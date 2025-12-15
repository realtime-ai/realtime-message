import {
  encode,
  decode,
  createReply,
  CHANNEL_EVENTS,
  type Message,
  type JoinPayload,
  type BroadcastPayload,
  type PresencePayload,
} from '@realtime-message/shared'
import type { Env, ChannelMember, PresenceState } from '../types.js'

interface WebSocketWithInfo extends WebSocket {
  clientId?: string
  joinSeq?: string
}

export class RealtimeChannel implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private topic: string = ''
  private members: Map<string, ChannelMember> = new Map()
  private presence: Map<string, PresenceState> = new Map()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env

    // Restore WebSocket sessions on wake
    this.state.getWebSockets().forEach((ws) => {
      const meta = this.state.getWebSocketAutoResponseTimestamp(ws)
      // Restore session from hibernation if needed
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract topic from path: /realtime/:topic
    const pathParts = url.pathname.split('/')
    this.topic = pathParts[2] || 'default'

    // Handle WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // Handle HTTP API
    return this.handleApi(request)
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID()

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocketWithInfo]

    // Store client info on WebSocket
    server.clientId = clientId
    server.joinSeq = '0'

    // Accept the WebSocket with hibernation support
    this.state.acceptWebSocket(server)

    console.log(`[RealtimeChannel] Client ${clientId} connected to ${this.topic}`)

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
        console.error('[RealtimeChannel] Invalid message format')
        return
      }

      const { join_seq, seq, topic, event, payload } = decoded

      // Handle different events
      switch (event) {
        case CHANNEL_EVENTS.join:
          await this.handleJoin(ws, join_seq, seq, topic, payload as JoinPayload)
          break
        case CHANNEL_EVENTS.leave:
          await this.handleLeave(ws, join_seq, seq, topic)
          break
        case CHANNEL_EVENTS.broadcast:
          await this.handleBroadcast(ws, join_seq, seq, topic, payload as BroadcastPayload)
          break
        case 'presence':
          await this.handlePresence(ws, join_seq, seq, topic, payload as PresencePayload)
          break
        case CHANNEL_EVENTS.heartbeat:
          this.handleHeartbeat(ws, join_seq, seq)
          break
        default:
          console.log(`[RealtimeChannel] Unknown event: ${event}`)
      }
    } catch (error) {
      console.error('[RealtimeChannel] Error processing message:', error)
    }
  }

  async webSocketClose(ws: WebSocketWithInfo, code: number, reason: string): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    console.log(`[RealtimeChannel] Client ${clientId} disconnected: ${code} ${reason}`)

    // Remove from members
    const member = this.members.get(clientId)
    if (member) {
      this.members.delete(clientId)

      // Handle presence leave if enabled
      if (member.config.presence.enabled && member.config.presence.key) {
        const presenceKey = member.config.presence.key
        this.presence.delete(presenceKey)

        // Broadcast presence leave
        const leaveMessage: Message = {
          join_seq: null,
          seq: null,
          topic: this.topic,
          event: CHANNEL_EVENTS.presence_diff,
          payload: { joins: {}, leaves: { [presenceKey]: {} } },
        }
        this.broadcast(encode(leaveMessage), clientId)
      }
    }
  }

  async webSocketError(ws: WebSocketWithInfo, error: unknown): Promise<void> {
    console.error('[RealtimeChannel] WebSocket error:', error)
    const clientId = ws.clientId
    if (clientId) {
      this.members.delete(clientId)
    }
  }

  private async handleJoin(
    ws: WebSocketWithInfo,
    joinSeq: string | null,
    seq: string | null,
    topic: string,
    payload: JoinPayload
  ): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    // Check if already joined
    if (this.members.has(clientId)) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Already joined this channel',
      })
      ws.send(encode(reply))
      return
    }

    // Create member
    const member: ChannelMember = {
      clientId,
      ws,
      joinSeq: joinSeq || '0',
      config: {
        broadcast: {
          self: payload.config?.broadcast?.self ?? false,
          ack: payload.config?.broadcast?.ack ?? false,
        },
        presence: {
          key: payload.config?.presence?.key ?? '',
          enabled: payload.config?.presence?.enabled ?? false,
        },
      },
    }

    this.members.set(clientId, member)
    ws.joinSeq = joinSeq || '0'

    console.log(`[RealtimeChannel] ${clientId} joined ${topic}. Members: ${this.members.size}`)

    // Send join reply
    const reply = createReply(seq, topic, 'ok', {
      presence_ref: member.config.presence.key || clientId,
    })
    ws.send(encode(reply))

    // Handle presence if enabled
    if (member.config.presence.enabled && member.config.presence.key) {
      // Send current presence state
      const presenceState: Record<string, PresenceState> = {}
      for (const [key, state] of this.presence) {
        presenceState[key] = state
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
    joinSeq: string | null,
    seq: string | null,
    topic: string
  ): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    const member = this.members.get(clientId)
    if (!member) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel',
      })
      ws.send(encode(reply))
      return
    }

    // Handle presence leave
    if (member.config.presence.enabled && member.config.presence.key) {
      const presenceKey = member.config.presence.key
      this.presence.delete(presenceKey)

      // Broadcast presence leave
      const leaveMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: { joins: {}, leaves: { [presenceKey]: {} } },
      }
      this.broadcast(encode(leaveMessage), clientId)
    }

    this.members.delete(clientId)

    console.log(`[RealtimeChannel] ${clientId} left ${topic}. Members: ${this.members.size}`)

    // Send leave reply
    const reply = createReply(seq, topic, 'ok', {})
    ws.send(encode(reply))
  }

  private async handleBroadcast(
    ws: WebSocketWithInfo,
    joinSeq: string | null,
    seq: string | null,
    topic: string,
    payload: BroadcastPayload
  ): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    const member = this.members.get(clientId)
    if (!member) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel',
      })
      ws.send(encode(reply))
      return
    }

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
    const excludeClientId = member.config.broadcast.self ? undefined : clientId
    this.broadcast(encoded, excludeClientId)

    // Send ack if requested
    if (member.config.broadcast.ack) {
      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    }
  }

  private async handlePresence(
    ws: WebSocketWithInfo,
    joinSeq: string | null,
    seq: string | null,
    topic: string,
    payload: PresencePayload
  ): Promise<void> {
    const clientId = ws.clientId
    if (!clientId) return

    const member = this.members.get(clientId)
    if (!member || !member.config.presence.enabled) {
      return
    }

    const presenceKey = member.config.presence.key || clientId

    if (payload.event === 'track') {
      // Track presence
      const state = (payload.payload as PresenceState) || {}
      this.presence.set(presenceKey, state)

      // Broadcast presence join
      const joinMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: { joins: { [presenceKey]: state }, leaves: {} },
      }
      this.broadcast(encode(joinMessage), clientId)
    } else if (payload.event === 'untrack') {
      // Untrack presence
      this.presence.delete(presenceKey)

      // Broadcast presence leave
      const leaveMessage: Message = {
        join_seq: null,
        seq: null,
        topic,
        event: CHANNEL_EVENTS.presence_diff,
        payload: { joins: {}, leaves: { [presenceKey]: {} } },
      }
      this.broadcast(encode(leaveMessage), clientId)
    }
  }

  private handleHeartbeat(
    ws: WebSocketWithInfo,
    joinSeq: string | null,
    seq: string | null
  ): void {
    // Reply with heartbeat ack
    const reply = createReply(seq, 'phoenix', 'ok', {})
    ws.send(encode(reply))
  }

  private broadcast(message: string, excludeClientId?: string): void {
    for (const [clientId, member] of this.members) {
      if (excludeClientId && clientId === excludeClientId) {
        continue
      }
      try {
        member.ws.send(message)
      } catch (error) {
        console.error(`[RealtimeChannel] Error sending to ${clientId}:`, error)
      }
    }
  }

  private async handleApi(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // POST /broadcast - External broadcast API
    if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
      try {
        const body = await request.json() as BroadcastPayload
        const broadcastMessage: Message = {
          join_seq: null,
          seq: null,
          topic: this.topic,
          event: CHANNEL_EVENTS.broadcast,
          payload: body,
        }
        this.broadcast(encode(broadcastMessage))
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // GET /presence - Get current presence state
    if (request.method === 'GET' && url.pathname.endsWith('/presence')) {
      const presenceState: Record<string, PresenceState> = {}
      for (const [key, state] of this.presence) {
        presenceState[key] = state
      }
      return new Response(JSON.stringify(presenceState), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /stats - Get channel stats
    if (request.method === 'GET' && url.pathname.endsWith('/stats')) {
      return new Response(JSON.stringify({
        topic: this.topic,
        members: this.members.size,
        presence: this.presence.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}

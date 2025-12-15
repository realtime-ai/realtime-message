/**
 * RealtimeGateway - WebSocket Gateway Durable Object
 *
 * This Durable Object acts as a gateway for WebSocket connections,
 * handling multiple channel subscriptions over a single WebSocket connection.
 * This provides compatibility with the SDK which expects a single WebSocket
 * connection that can join/leave multiple channels.
 *
 * Uses Cloudflare Hibernation API with tags and attachments for persistence:
 * - Tags: Used to track which channels a WebSocket is subscribed to
 * - Attachment: Stores clientId and channel subscription configs
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
} from '@realtime-message/shared'
import type { Env, PresenceState } from '../types.js'

/**
 * Channel subscription configuration
 */
interface ChannelSubscription {
  topic: string
  joinSeq: string
  config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }
  /** Presence metadata for this channel (if tracked) */
  presenceMeta?: PresenceState
}

/**
 * WebSocket attachment that survives hibernation
 * Stores clientId, channel subscriptions, and presence data
 */
interface WebSocketAttachment {
  clientId: string
  channels: Record<string, ChannelSubscription>
}

export class RealtimeGateway implements DurableObject {
  private state: DurableObjectState
  private env: Env

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

  /**
   * Handle WebSocket upgrade request
   * Uses Cloudflare Hibernation API with tags for channel tracking
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID()

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Accept the WebSocket with hibernation support
    // Initial tag is just the clientId - channel tags added on join
    this.state.acceptWebSocket(server, [clientId])

    // Store client info using hibernation-safe attachment
    const attachment: WebSocketAttachment = {
      clientId,
      channels: {},
    }
    server.serializeAttachment(attachment)

    console.log(`[RealtimeGateway] Client ${clientId} connected`)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle incoming WebSocket message
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const decoded = decode(data)

      if (!decoded) {
        console.error('[RealtimeGateway] Invalid message format')
        return
      }

      const { join_seq, seq, topic, event, payload } = decoded

      // Get attachment (survives hibernation)
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
      if (!attachment?.clientId) {
        console.error('[RealtimeGateway] No clientId in WebSocket attachment')
        return
      }

      const clientId = attachment.clientId

      // Handle system heartbeat
      if (topic === SYSTEM_TOPIC && event === CHANNEL_EVENTS.heartbeat) {
        this.handleHeartbeat(ws, seq)
        return
      }

      // Handle channel events
      switch (event) {
        case CHANNEL_EVENTS.join:
          await this.handleJoin(ws, attachment, join_seq, seq, topic, payload as JoinPayload)
          break
        case CHANNEL_EVENTS.leave:
          await this.handleLeave(ws, attachment, seq, topic)
          break
        case CHANNEL_EVENTS.broadcast:
          await this.handleBroadcast(ws, attachment, seq, topic, payload as BroadcastPayload)
          break
        case 'presence':
          await this.handlePresence(ws, attachment, seq, topic, payload as PresencePayload)
          break
        default:
          console.log(`[RealtimeGateway] Unknown event: ${event}`)
      }
    } catch (error) {
      console.error('[RealtimeGateway] Error processing message:', error)
    }
  }

  /**
   * Handle WebSocket close event
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (!attachment?.clientId) return

    console.log(`[RealtimeGateway] Client ${attachment.clientId} disconnected: ${code} ${reason}`)

    // Broadcast presence leave for all channels
    for (const [topic, subscription] of Object.entries(attachment.channels)) {
      if (subscription.config.presence.enabled && subscription.config.presence.key) {
        this.broadcastPresenceLeave(topic, subscription.config.presence.key, attachment.clientId)
      }
    }
  }

  /**
   * Handle WebSocket error event
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[RealtimeGateway] WebSocket error:', error)
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (attachment?.clientId) {
      // Cleanup presence on error
      for (const [topic, subscription] of Object.entries(attachment.channels)) {
        if (subscription.config.presence.enabled && subscription.config.presence.key) {
          this.broadcastPresenceLeave(topic, subscription.config.presence.key, attachment.clientId)
        }
      }
    }
  }

  private handleHeartbeat(ws: WebSocket, seq: string | null): void {
    const reply = createReply(seq, SYSTEM_TOPIC, 'ok', {})
    ws.send(encode(reply))
  }

  /**
   * Handle channel join
   * Adds channel tag to WebSocket and updates attachment
   */
  private async handleJoin(
    ws: WebSocket,
    attachment: WebSocketAttachment,
    joinSeq: string | null,
    seq: string | null,
    topic: string,
    payload: JoinPayload
  ): Promise<void> {
    const clientId = attachment.clientId

    // Check if already joined this channel
    if (attachment.channels[topic]) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Already joined this channel',
      })
      ws.send(encode(reply))
      return
    }

    // Create subscription config
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
          enabled: !!presenceKey,
        },
      },
    }

    // Update attachment with new channel subscription
    attachment.channels[topic] = subscription
    ws.serializeAttachment(attachment)

    // Get current tags and add channel tag
    const currentTags = this.state.getTags(ws)
    const channelTag = `channel:${topic}`
    if (!currentTags.includes(channelTag)) {
      // Re-accept with updated tags (Cloudflare doesn't have addTag, so we track via attachment)
      // Tags are set at accept time, but we can use getWebSockets to filter
      // Actually, we need to track membership differently since tags are immutable
      // We'll use attachment.channels as the source of truth and iterate all sockets
    }

    // Count members by iterating all WebSockets
    const memberCount = this.countChannelMembers(topic)

    console.log(`[RealtimeGateway] ${clientId} joined ${topic}. Members: ${memberCount}`)

    // Send join reply
    const reply = createReply(seq, topic, 'ok', {
      presence_ref: subscription.config.presence.key || clientId,
    })
    ws.send(encode(reply))

    // Send current presence state if presence is enabled
    if (subscription.config.presence.enabled) {
      const presenceState = this.getChannelPresenceState(topic)
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

  /**
   * Handle channel leave
   */
  private async handleLeave(
    ws: WebSocket,
    attachment: WebSocketAttachment,
    seq: string | null,
    topic: string
  ): Promise<void> {
    const clientId = attachment.clientId
    const subscription = attachment.channels[topic]

    if (!subscription) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel',
      })
      ws.send(encode(reply))
      return
    }

    // Handle presence leave
    if (subscription.config.presence.enabled && subscription.config.presence.key) {
      this.broadcastPresenceLeave(topic, subscription.config.presence.key, clientId)
    }

    // Remove channel from attachment
    delete attachment.channels[topic]
    ws.serializeAttachment(attachment)

    const memberCount = this.countChannelMembers(topic)
    console.log(`[RealtimeGateway] ${clientId} left ${topic}. Members: ${memberCount}`)

    // Send leave reply
    const reply = createReply(seq, topic, 'ok', {})
    ws.send(encode(reply))
  }

  /**
   * Handle broadcast message
   * Uses getWebSockets to find all channel members
   */
  private async handleBroadcast(
    ws: WebSocket,
    attachment: WebSocketAttachment,
    seq: string | null,
    topic: string,
    payload: BroadcastPayload
  ): Promise<void> {
    const clientId = attachment.clientId
    const subscription = attachment.channels[topic]

    if (!subscription) {
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

    // Broadcast to all members of the channel
    const includeSelf = subscription.config.broadcast.self
    this.broadcastToChannel(topic, encoded, includeSelf ? undefined : clientId)

    // Send ack if requested
    if (subscription.config.broadcast.ack) {
      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    }
  }

  /**
   * Handle presence update
   * Stores presence data in WebSocket attachment for hibernation persistence
   */
  private async handlePresence(
    ws: WebSocket,
    attachment: WebSocketAttachment,
    seq: string | null,
    topic: string,
    payload: PresencePayload
  ): Promise<void> {
    const clientId = attachment.clientId
    const subscription = attachment.channels[topic]

    if (!subscription || !subscription.config.presence.enabled) {
      const reply = createReply(seq, topic, 'error', {
        reason: 'Not a member of this channel or presence not enabled',
      })
      ws.send(encode(reply))
      return
    }

    const presenceKey = subscription.config.presence.key || clientId

    if (payload.event === 'track') {
      const meta = (payload.payload as { meta?: PresenceState })?.meta || {}

      // Store presence in attachment (survives hibernation)
      subscription.presenceMeta = meta
      ws.serializeAttachment(attachment)

      // Broadcast presence join to other members
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
      this.broadcastToChannel(topic, encode(joinMessage), clientId)

      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    } else if (payload.event === 'untrack') {
      // Clear presence from attachment
      delete subscription.presenceMeta
      ws.serializeAttachment(attachment)

      this.broadcastPresenceLeave(topic, presenceKey, clientId)

      const reply = createReply(seq, topic, 'ok', {})
      ws.send(encode(reply))
    }
  }

  /**
   * Broadcast presence leave
   */
  private broadcastPresenceLeave(topic: string, presenceKey: string, excludeClientId: string): void {
    // Broadcast presence leave
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
    this.broadcastToChannel(topic, encode(leaveMessage), excludeClientId)
  }

  /**
   * Get current presence state for a channel
   * Rebuilds from all WebSocket attachments (survives hibernation)
   */
  private getChannelPresenceState(topic: string): Record<string, Array<{ presence_ref: string; meta: PresenceState }>> {
    const presenceState: Record<string, Array<{ presence_ref: string; meta: PresenceState }>> = {}
    const webSockets = this.state.getWebSockets()

    for (const ws of webSockets) {
      try {
        const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
        if (!attachment) continue

        const subscription = attachment.channels[topic]
        if (!subscription || !subscription.config.presence.enabled) continue

        // Only include if presence is tracked (has presenceMeta)
        if (subscription.presenceMeta !== undefined) {
          const presenceKey = subscription.config.presence.key || attachment.clientId
          presenceState[presenceKey] = [{
            presence_ref: presenceKey,
            meta: subscription.presenceMeta,
          }]
        }
      } catch {
        // Skip invalid attachments
      }
    }

    return presenceState
  }

  /**
   * Count members in a channel by checking all WebSocket attachments
   */
  private countChannelMembers(topic: string): number {
    let count = 0
    const webSockets = this.state.getWebSockets()

    for (const ws of webSockets) {
      try {
        const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
        if (attachment?.channels[topic]) {
          count++
        }
      } catch {
        // Skip invalid attachments
      }
    }

    return count
  }

  /**
   * Broadcast a message to all members of a channel
   * Iterates all WebSockets and checks attachment for channel membership
   */
  private broadcastToChannel(topic: string, message: string, excludeClientId?: string): void {
    const webSockets = this.state.getWebSockets()

    for (const ws of webSockets) {
      try {
        const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
        if (!attachment) continue

        // Check if this WebSocket is subscribed to the channel
        if (!attachment.channels[topic]) continue

        // Skip excluded client
        if (excludeClientId && attachment.clientId === excludeClientId) continue

        ws.send(message)
      } catch (error) {
        console.error('[RealtimeGateway] Error broadcasting:', error)
      }
    }
  }
}

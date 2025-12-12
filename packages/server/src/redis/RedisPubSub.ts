import type { WebSocket } from 'ws'
import { encode, type Message, type BroadcastPayload, CHANNEL_EVENTS } from '@realtime-message/shared'
import type { RedisAdapter } from './RedisAdapter.js'
import type { ChannelManager } from '../ChannelManager.js'

interface PubSubMessage {
  type: 'broadcast' | 'presence_diff'
  topic: string
  senderId: string // client ID of sender (to exclude from local delivery)
  serverInstanceId: string // to identify which server sent this
  payload: unknown
}

/**
 * RedisPubSub - Handles cross-instance message distribution via Redis Pub/Sub
 */
export class RedisPubSub {
  private instanceId: string
  private subscribedTopics: Set<string> = new Set()

  constructor(
    private redis: RedisAdapter,
    private channelManager: ChannelManager
  ) {
    // Generate unique instance ID
    this.instanceId = `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    console.log(`[RedisPubSub] Instance ID: ${this.instanceId}`)
  }

  /**
   * Subscribe to a topic for cross-instance messages
   */
  async subscribeTopic(topic: string): Promise<void> {
    if (this.subscribedTopics.has(topic)) {
      return
    }

    this.subscribedTopics.add(topic)
    const channel = `channel:${topic}`

    await this.redis.subscribe(channel, (message) => {
      this.handleMessage(message)
    })

    console.log(`[RedisPubSub] Subscribed to ${channel}`)
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribeTopic(topic: string): Promise<void> {
    if (!this.subscribedTopics.has(topic)) {
      return
    }

    this.subscribedTopics.delete(topic)
    const channel = `channel:${topic}`
    await this.redis.unsubscribe(channel)

    console.log(`[RedisPubSub] Unsubscribed from ${channel}`)
  }

  /**
   * Publish a broadcast message to other instances
   */
  async publishBroadcast(
    topic: string,
    senderId: string,
    event: string,
    payload: unknown
  ): Promise<void> {
    const pubSubMessage: PubSubMessage = {
      type: 'broadcast',
      topic,
      senderId,
      serverInstanceId: this.instanceId,
      payload: {
        type: 'broadcast',
        event,
        payload,
      } as BroadcastPayload,
    }

    const channel = `channel:${topic}`
    await this.redis.publish(channel, JSON.stringify(pubSubMessage))
  }

  /**
   * Publish a presence diff to other instances
   */
  async publishPresenceDiff(
    topic: string,
    senderId: string,
    diff: { joins: Record<string, unknown[]>; leaves: Record<string, unknown[]> }
  ): Promise<void> {
    const pubSubMessage: PubSubMessage = {
      type: 'presence_diff',
      topic,
      senderId,
      serverInstanceId: this.instanceId,
      payload: diff,
    }

    const channel = `channel:${topic}`
    await this.redis.publish(channel, JSON.stringify(pubSubMessage))
  }

  /**
   * Handle incoming message from Redis
   */
  private handleMessage(messageStr: string): void {
    try {
      const pubSubMessage = JSON.parse(messageStr) as PubSubMessage

      // Ignore messages from this instance
      if (pubSubMessage.serverInstanceId === this.instanceId) {
        return
      }

      console.log(
        `[RedisPubSub] Received ${pubSubMessage.type} from ${pubSubMessage.serverInstanceId} for ${pubSubMessage.topic}`
      )

      if (pubSubMessage.type === 'broadcast') {
        this.handleBroadcast(pubSubMessage)
      } else if (pubSubMessage.type === 'presence_diff') {
        this.handlePresenceDiff(pubSubMessage)
      }
    } catch (error) {
      console.error('[RedisPubSub] Failed to parse message:', error)
    }
  }

  /**
   * Handle broadcast message from another instance
   */
  private handleBroadcast(pubSubMessage: PubSubMessage): void {
    const { topic, payload } = pubSubMessage
    const broadcastPayload = payload as BroadcastPayload

    // Get local members of this channel
    const members = this.channelManager.getMembers(topic)

    const message: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.broadcast,
      payload: broadcastPayload,
    }
    const encoded = encode(message)

    // Send to all local members
    for (const member of members) {
      try {
        member.ws.send(encoded)
      } catch (error) {
        console.error(`[RedisPubSub] Failed to send to ${member.clientId}`)
      }
    }
  }

  /**
   * Handle presence diff from another instance
   */
  private handlePresenceDiff(pubSubMessage: PubSubMessage): void {
    const { topic, payload } = pubSubMessage
    const diff = payload as { joins: Record<string, unknown[]>; leaves: Record<string, unknown[]> }

    // Get local members of this channel
    const members = this.channelManager.getMembers(topic)

    const message: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.presence_diff,
      payload: diff,
    }
    const encoded = encode(message)

    // Send to all local members
    for (const member of members) {
      try {
        member.ws.send(encoded)
      } catch (error) {
        console.error(`[RedisPubSub] Failed to send diff to ${member.clientId}`)
      }
    }
  }

  /**
   * Get instance ID
   */
  getInstanceId(): string {
    return this.instanceId
  }
}

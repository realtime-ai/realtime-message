import type { WebSocket } from 'ws'
import {
  CHANNEL_EVENTS,
  encode,
  type Message,
  type BroadcastPayload,
} from '@realtime-message/shared'
import type { ChannelManager } from './ChannelManager.js'

export interface BroadcastOptions {
  self?: boolean // Send to self (default: false)
  ack?: boolean  // Require acknowledgment (default: false)
}

export interface BroadcastResult {
  success: boolean
  error?: string
  recipientCount?: number
}

/**
 * BroadcastHandler - Handles broadcasting messages within channels
 */
export class BroadcastHandler {
  constructor(private channelManager: ChannelManager) {}

  /**
   * Broadcast a message to all members of a channel
   */
  broadcast(
    topic: string,
    senderId: string,
    senderWs: WebSocket,
    event: string,
    payload: unknown,
    options: BroadcastOptions = {}
  ): BroadcastResult {
    const { self = false } = options

    // Get channel members
    const members = this.channelManager.getMembers(topic)
    if (members.length === 0) {
      return { success: false, error: 'Channel not found or empty' }
    }

    // Build broadcast message
    const broadcastPayload: BroadcastPayload = {
      type: 'broadcast',
      event,
      payload,
    }

    const message: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.broadcast,
      payload: broadcastPayload,
    }

    const encoded = encode(message)
    let recipientCount = 0

    // Send to all members
    for (const member of members) {
      // Skip sender unless self=true
      if (!self && member.clientId === senderId) {
        continue
      }

      try {
        member.ws.send(encoded)
        recipientCount++
      } catch (error) {
        console.error(`[BroadcastHandler] Failed to send to ${member.clientId}:`, error)
      }
    }

    console.log(
      `[BroadcastHandler] Broadcast '${event}' on ${topic}: ${recipientCount} recipients (self=${self})`
    )

    return { success: true, recipientCount }
  }
}

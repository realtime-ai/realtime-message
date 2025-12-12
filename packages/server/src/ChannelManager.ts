import type { WebSocket } from 'ws'
import type { JoinPayload } from '@realtime-message/shared'

/**
 * Channel member information
 */
export interface ChannelMember {
  clientId: string
  ws: WebSocket
  joinSeq: string
  config: {
    broadcast: { self: boolean; ack: boolean }
    presence: { key: string; enabled: boolean }
  }
}

/**
 * Channel information
 */
export interface Channel {
  topic: string
  members: Map<string, ChannelMember> // clientId -> member
}

/**
 * ChannelManager - Manages channels and their members
 */
export class ChannelManager {
  private channels: Map<string, Channel> = new Map()

  /**
   * Join a client to a channel
   */
  join(
    topic: string,
    clientId: string,
    ws: WebSocket,
    joinSeq: string,
    payload: JoinPayload
  ): { success: boolean; error?: string } {
    // Get or create channel
    let channel = this.channels.get(topic)
    if (!channel) {
      channel = {
        topic,
        members: new Map(),
      }
      this.channels.set(topic, channel)
    }

    // Check if already joined
    if (channel.members.has(clientId)) {
      return { success: false, error: 'Already joined this channel' }
    }

    // Add member
    const member: ChannelMember = {
      clientId,
      ws,
      joinSeq,
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

    channel.members.set(clientId, member)
    console.log(`[ChannelManager] ${clientId} joined ${topic}. Members: ${channel.members.size}`)

    return { success: true }
  }

  /**
   * Remove a client from a channel
   */
  leave(topic: string, clientId: string): { success: boolean; error?: string } {
    const channel = this.channels.get(topic)
    if (!channel) {
      return { success: false, error: 'Channel not found' }
    }

    if (!channel.members.has(clientId)) {
      return { success: false, error: 'Not a member of this channel' }
    }

    channel.members.delete(clientId)
    console.log(`[ChannelManager] ${clientId} left ${topic}. Members: ${channel.members.size}`)

    // Clean up empty channels
    if (channel.members.size === 0) {
      this.channels.delete(topic)
      console.log(`[ChannelManager] Channel ${topic} removed (empty)`)
    }

    return { success: true }
  }

  /**
   * Remove a client from all channels (called on disconnect)
   */
  leaveAll(clientId: string): string[] {
    const leftChannels: string[] = []

    for (const [topic, channel] of this.channels) {
      if (channel.members.has(clientId)) {
        channel.members.delete(clientId)
        leftChannels.push(topic)

        // Clean up empty channels
        if (channel.members.size === 0) {
          this.channels.delete(topic)
        }
      }
    }

    if (leftChannels.length > 0) {
      console.log(`[ChannelManager] ${clientId} left channels: ${leftChannels.join(', ')}`)
    }

    return leftChannels
  }

  /**
   * Get channel by topic
   */
  getChannel(topic: string): Channel | undefined {
    return this.channels.get(topic)
  }

  /**
   * Get member from channel
   */
  getMember(topic: string, clientId: string): ChannelMember | undefined {
    return this.channels.get(topic)?.members.get(clientId)
  }

  /**
   * Get all members of a channel
   */
  getMembers(topic: string): ChannelMember[] {
    const channel = this.channels.get(topic)
    return channel ? Array.from(channel.members.values()) : []
  }

  /**
   * Get channels a client has joined
   */
  getClientChannels(clientId: string): string[] {
    const topics: string[] = []
    for (const [topic, channel] of this.channels) {
      if (channel.members.has(clientId)) {
        topics.push(topic)
      }
    }
    return topics
  }

  /**
   * Get statistics
   */
  getStats(): { totalChannels: number; totalMembers: number } {
    let totalMembers = 0
    for (const channel of this.channels.values()) {
      totalMembers += channel.members.size
    }
    return {
      totalChannels: this.channels.size,
      totalMembers,
    }
  }
}

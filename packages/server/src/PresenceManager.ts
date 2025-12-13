import type { WebSocket } from 'ws'
import {
  CHANNEL_EVENTS,
  encode,
  type Message,
  type RealtimePresenceState,
  type Presence,
} from '@realtime-message/shared'
import type { ChannelManager } from './ChannelManager.js'

interface PresenceEntry<T = Record<string, unknown>> {
  clientId: string
  key: string
  presenceRef: string
  meta: T
}

/**
 * PresenceManager - Manages user presence (online status) in channels
 */
export class PresenceManager {
  // topic -> (key -> presence entries)
  private presences: Map<string, Map<string, PresenceEntry[]>> = new Map()
  private presenceRefCounter = 0

  constructor(private channelManager: ChannelManager) {}

  /**
   * Generate a unique presence ref
   */
  private makePresenceRef(): string {
    return `pres_${++this.presenceRefCounter}`
  }

  /**
   * Track a user's presence in a channel
   */
  track(
    topic: string,
    clientId: string,
    key: string,
    meta: Record<string, unknown> = {}
  ): { success: boolean; error?: string } {
    // Check if client is member of channel
    const member = this.channelManager.getMember(topic, clientId)
    if (!member) {
      return { success: false, error: 'Not a member of channel' }
    }

    // Get or create channel presences
    let channelPresences = this.presences.get(topic)
    if (!channelPresences) {
      channelPresences = new Map()
      this.presences.set(topic, channelPresences)
    }

    // Get or create key presences
    let keyPresences = channelPresences.get(key)
    if (!keyPresences) {
      keyPresences = []
      channelPresences.set(key, keyPresences)
    }

    // Check if already tracked by this client with this key
    const existingIdx = keyPresences.findIndex((p) => p.clientId === clientId)
    if (existingIdx !== -1) {
      // Update existing presence
      const existing = keyPresences[existingIdx]
      if (existing) {
        existing.meta = meta
      }
      console.log(`[PresenceManager] Updated presence for ${key} in ${topic}`)
    } else {
      // Add new presence
      const entry: PresenceEntry = {
        clientId,
        key,
        presenceRef: this.makePresenceRef(),
        meta,
      }
      keyPresences.push(entry)
      console.log(`[PresenceManager] Tracked ${key} in ${topic}`)
    }

    // Broadcast presence_diff to other members
    this.broadcastDiff(topic, clientId, {
      joins: { [key]: this.formatPresences(keyPresences) },
      leaves: {},
    })

    return { success: true }
  }

  /**
   * Untrack a user's presence in a channel
   */
  untrack(
    topic: string,
    clientId: string,
    key?: string
  ): { success: boolean; error?: string } {
    const channelPresences = this.presences.get(topic)
    if (!channelPresences) {
      return { success: true } // Nothing to untrack
    }

    const leaves: Record<string, Presence[]> = {}

    if (key) {
      // Untrack specific key
      const keyPresences = channelPresences.get(key)
      if (keyPresences) {
        const idx = keyPresences.findIndex((p) => p.clientId === clientId)
        if (idx !== -1) {
          const removed = keyPresences.splice(idx, 1)
          leaves[key] = this.formatPresences(removed)
          if (keyPresences.length === 0) {
            channelPresences.delete(key)
          }
        }
      }
    } else {
      // Untrack all keys for this client
      for (const [k, presences] of channelPresences) {
        const idx = presences.findIndex((p) => p.clientId === clientId)
        if (idx !== -1) {
          const removed = presences.splice(idx, 1)
          leaves[k] = this.formatPresences(removed)
          if (presences.length === 0) {
            channelPresences.delete(k)
          }
        }
      }
    }

    // Clean up empty channel presences
    if (channelPresences.size === 0) {
      this.presences.delete(topic)
    }

    // Broadcast presence_diff if there were leaves
    if (Object.keys(leaves).length > 0) {
      this.broadcastDiff(topic, clientId, { joins: {}, leaves })
      console.log(`[PresenceManager] Untracked from ${topic}:`, Object.keys(leaves))
    }

    return { success: true }
  }

  /**
   * Get full presence state for a channel
   */
  getState(topic: string): RealtimePresenceState {
    const channelPresences = this.presences.get(topic)
    if (!channelPresences) {
      return {}
    }

    const state: RealtimePresenceState = {}
    for (const [key, presences] of channelPresences) {
      state[key] = this.formatPresences(presences)
    }
    return state
  }

  /**
   * Send full presence state to a new member
   */
  sendState(topic: string, ws: WebSocket): void {
    const state = this.getState(topic)
    const message: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.presence_state,
      payload: state,
    }
    ws.send(encode(message))
  }

  /**
   * Handle client disconnect - untrack from all channels
   */
  handleDisconnect(clientId: string): void {
    for (const [topic] of this.presences) {
      this.untrack(topic, clientId)
    }
  }

  /**
   * Format presence entries for transmission
   */
  private formatPresences(entries: PresenceEntry[]): Presence[] {
    return entries.map((e) => ({
      presence_ref: e.presenceRef,
      meta: e.meta,
    }))
  }

  /**
   * Broadcast presence_diff to channel members
   */
  private broadcastDiff(
    topic: string,
    excludeClientId: string,
    diff: { joins: Record<string, Presence[]>; leaves: Record<string, Presence[]> }
  ): void {
    const members = this.channelManager.getMembers(topic)
    const message: Message = {
      join_seq: null,
      seq: null,
      topic,
      event: CHANNEL_EVENTS.presence_diff,
      payload: diff,
    }
    const encoded = encode(message)

    for (const member of members) {
      if (member.clientId !== excludeClientId) {
        try {
          member.ws.send(encoded)
        } catch (error) {
          console.error(`[PresenceManager] Failed to send diff to ${member.clientId}`)
        }
      }
    }
  }
}

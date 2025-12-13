/**
 * Comprehensive Presence Tests
 *
 * These tests cover the bugs that were discovered:
 * 1. Presence data structure (meta property)
 * 2. Presence state sent to newly joined clients
 * 3. Presence cleanup on channel leave
 * 4. Self-presence visibility
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { RealtimeClient, RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'
import type { Presence, RealtimePresenceJoinPayload, RealtimePresenceLeavePayload } from '../packages/sdk/dist/index.js'

const WS_URL = process.env.WS_URL || 'ws://localhost:4000'

// Helper to wait for a condition
const waitFor = async (
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> => {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition')
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}

// Helper to wait for subscription
const waitForSubscribed = (channel: RealtimeChannel): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000)
    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        clearTimeout(timeout)
        resolve()
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        clearTimeout(timeout)
        reject(new Error('Channel error'))
      }
    })
  })
}

describe('Presence Tests', () => {
  const roomTopic = `room:presence-test-${Date.now()}`

  describe('Presence Data Structure', () => {
    let client: RealtimeClient
    let channel: RealtimeChannel

    beforeEach(async () => {
      client = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      client.connect()
      await new Promise((r) => setTimeout(r, 500))
    })

    afterEach(async () => {
      if (channel) {
        await channel.unsubscribe()
      }
      client.disconnect()
    })

    it('should have meta property in presence entries', async () => {
      const uniqueTopic = `${roomTopic}-structure-${Date.now()}`

      // Use two clients - one to track, one to observe the data structure
      const observerClient = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      observerClient.connect()
      await new Promise((r) => setTimeout(r, 500))

      // First client joins and tracks
      channel = client.channel(uniqueTopic, {
        config: { presence: { key: 'test-user' } },
      })

      await waitForSubscribed(channel)
      await channel.track({
        user: 'TestUser',
        status: 'online',
        color: '#ff0000',
      })

      // Wait for presence to be registered
      await new Promise((r) => setTimeout(r, 500))

      // Observer client joins and should receive presence state with correct structure
      const observerChannel = observerClient.channel(uniqueTopic, {
        config: { presence: { key: 'observer' } },
      })

      let presenceData: any = null

      observerChannel.on('presence', { event: 'sync' }, () => {
        presenceData = observerChannel.presenceState()
      })

      await waitForSubscribed(observerChannel)

      // Wait for sync
      await waitFor(() => presenceData !== null && Object.keys(presenceData).length > 0, 3000)

      // Verify presence state structure
      expect(presenceData).toBeDefined()
      const keys = Object.keys(presenceData)
      expect(keys).toContain('test-user')

      // Verify each presence entry has meta property
      const presences = presenceData['test-user']
      expect(Array.isArray(presences)).toBe(true)
      expect(presences.length).toBeGreaterThan(0)

      const presence = presences[0]
      expect(presence).toHaveProperty('presence_ref')
      expect(presence).toHaveProperty('meta')
      expect(presence.meta).toHaveProperty('user')
      expect(presence.meta).toHaveProperty('status')
      expect(presence.meta.user).toBe('TestUser')
      expect(presence.meta.status).toBe('online')

      // Cleanup
      await observerChannel.unsubscribe()
      observerClient.disconnect()
    })
  })

  describe('Presence State on Join', () => {
    let clientA: RealtimeClient
    let clientB: RealtimeClient
    let channelA: RealtimeChannel
    let channelB: RealtimeChannel

    beforeEach(async () => {
      clientA = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      clientB = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })

      clientA.connect()
      clientB.connect()
      await new Promise((r) => setTimeout(r, 500))
    })

    afterEach(async () => {
      if (channelA) await channelA.unsubscribe().catch(() => {})
      if (channelB) await channelB.unsubscribe().catch(() => {})
      clientA.disconnect()
      clientB.disconnect()
    })

    it('should receive existing presence state when joining', async () => {
      const uniqueTopic = `${roomTopic}-join-state-${Date.now()}`

      // Client A joins and tracks first
      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })

      await waitForSubscribed(channelA)
      await channelA.track({ user: 'Alice', status: 'online' })

      // Wait for A's presence to be registered
      await new Promise((r) => setTimeout(r, 500))

      // Client B joins - should see A's presence immediately
      channelB = clientB.channel(uniqueTopic, {
        config: { presence: { key: 'user-B' } },
      })

      let bSyncCount = 0
      let bPresenceState: any = null

      channelB.on('presence', { event: 'sync' }, () => {
        bSyncCount++
        bPresenceState = channelB.presenceState()
      })

      await waitForSubscribed(channelB)

      // Wait for sync
      await waitFor(() => bSyncCount > 0, 3000)

      // B should see A in the presence state
      expect(bPresenceState).toBeDefined()
      const keys = Object.keys(bPresenceState)
      expect(keys).toContain('user-A')

      // Verify A's data
      const aPresences = bPresenceState['user-A']
      expect(aPresences.length).toBeGreaterThan(0)
      expect(aPresences[0].meta.user).toBe('Alice')
    })

    it('should notify existing users when new user joins', async () => {
      const uniqueTopic = `${roomTopic}-join-notify-${Date.now()}`

      // Client A joins and tracks first
      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })

      const aJoinEvents: string[] = []

      channelA.on('presence', { event: 'join' }, (payload: RealtimePresenceJoinPayload<any>) => {
        aJoinEvents.push(payload.key)
      })

      await waitForSubscribed(channelA)
      await channelA.track({ user: 'Alice' })

      // Client B joins
      channelB = clientB.channel(uniqueTopic, {
        config: { presence: { key: 'user-B' } },
      })

      await waitForSubscribed(channelB)
      await channelB.track({ user: 'Bob' })

      // Wait for A to receive B's join
      await waitFor(() => aJoinEvents.includes('user-B'), 3000)

      expect(aJoinEvents).toContain('user-B')
    })
  })

  describe('Presence Cleanup on Leave', () => {
    let clientA: RealtimeClient
    let clientB: RealtimeClient
    let channelA: RealtimeChannel
    let channelB: RealtimeChannel

    beforeEach(async () => {
      clientA = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      clientB = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })

      clientA.connect()
      clientB.connect()
      await new Promise((r) => setTimeout(r, 500))
    })

    afterEach(async () => {
      if (channelA?.isJoined()) await channelA.unsubscribe().catch(() => {})
      if (channelB?.isJoined()) await channelB.unsubscribe().catch(() => {})
      clientA.disconnect()
      clientB.disconnect()
    })

    it('should remove presence when user leaves channel', async () => {
      const uniqueTopic = `${roomTopic}-leave-${Date.now()}`

      // Both clients join
      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })
      channelB = clientB.channel(uniqueTopic, {
        config: { presence: { key: 'user-B' } },
      })

      const aLeaveEvents: string[] = []

      channelA.on('presence', { event: 'leave' }, (payload: RealtimePresenceLeavePayload<any>) => {
        aLeaveEvents.push(payload.key)
      })

      await Promise.all([
        waitForSubscribed(channelA),
        waitForSubscribed(channelB),
      ])

      await channelA.track({ user: 'Alice' })
      await channelB.track({ user: 'Bob' })

      // Wait for both to be tracked
      await new Promise((r) => setTimeout(r, 500))

      // Verify A sees B
      let stateA = channelA.presenceState()
      expect(Object.keys(stateA)).toContain('user-B')

      // B leaves the channel (not disconnect)
      await channelB.unsubscribe()

      // Wait for A to receive leave event
      await waitFor(() => aLeaveEvents.includes('user-B'), 3000)

      // A should no longer see B
      stateA = channelA.presenceState()
      expect(Object.keys(stateA)).not.toContain('user-B')
    })

    it('should remove presence when user disconnects', async () => {
      const uniqueTopic = `${roomTopic}-disconnect-${Date.now()}`

      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })
      channelB = clientB.channel(uniqueTopic, {
        config: { presence: { key: 'user-B' } },
      })

      const aLeaveEvents: string[] = []

      channelA.on('presence', { event: 'leave' }, (payload: RealtimePresenceLeavePayload<any>) => {
        aLeaveEvents.push(payload.key)
      })

      await Promise.all([
        waitForSubscribed(channelA),
        waitForSubscribed(channelB),
      ])

      await channelA.track({ user: 'Alice' })
      await channelB.track({ user: 'Bob' })

      await new Promise((r) => setTimeout(r, 500))

      // B disconnects entirely
      clientB.disconnect()

      // Wait for A to receive leave event
      await waitFor(() => aLeaveEvents.includes('user-B'), 3000)

      const stateA = channelA.presenceState()
      expect(Object.keys(stateA)).not.toContain('user-B')
    })
  })

  describe('Self Presence', () => {
    let clientA: RealtimeClient
    let clientB: RealtimeClient
    let channelA: RealtimeChannel
    let channelB: RealtimeChannel

    beforeEach(async () => {
      clientA = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      clientB = new RealtimeClient(WS_URL, {
        heartbeatIntervalMs: 60000,
        logLevel: 'error',
      })
      clientA.connect()
      clientB.connect()
      await new Promise((r) => setTimeout(r, 500))
    })

    afterEach(async () => {
      if (channelA) await channelA.unsubscribe().catch(() => {})
      if (channelB) await channelB.unsubscribe().catch(() => {})
      clientA.disconnect()
      clientB.disconnect()
    })

    it('should be visible to other clients after tracking', async () => {
      const uniqueTopic = `${roomTopic}-self-${Date.now()}`

      // Client A joins and tracks
      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })

      await waitForSubscribed(channelA)
      await channelA.track({ user: 'Alice', status: 'online' })

      // Wait for A's presence to be stored
      await new Promise((r) => setTimeout(r, 500))

      // Client B joins - should see A
      channelB = clientB.channel(uniqueTopic, {
        config: { presence: { key: 'user-B' } },
      })

      let bSyncCount = 0
      channelB.on('presence', { event: 'sync' }, () => {
        bSyncCount++
      })

      await waitForSubscribed(channelB)

      // Wait for B to receive sync
      await waitFor(() => bSyncCount > 0, 3000)

      // B should see A in presence state
      const stateB = channelB.presenceState()
      expect(Object.keys(stateB)).toContain('user-A')
      expect(stateB['user-A'][0].meta.user).toBe('Alice')
    })

    it('track should return success status', async () => {
      const uniqueTopic = `${roomTopic}-track-${Date.now()}`

      channelA = clientA.channel(uniqueTopic, {
        config: { presence: { key: 'user-A' } },
      })

      await waitForSubscribed(channelA)

      const result = await channelA.track({ user: 'Alice', status: 'online' })
      expect(result.status).toBe('ok')

      // Cleanup immediately to avoid hook timeout
      await channelA.unsubscribe()
      channelA = null as any
    })
  })

  describe('Multi-Client Presence Synchronization', () => {
    const clients: RealtimeClient[] = []
    const channels: RealtimeChannel[] = []

    afterEach(async () => {
      for (const channel of channels) {
        await channel.unsubscribe().catch(() => {})
      }
      for (const client of clients) {
        client.disconnect()
      }
      clients.length = 0
      channels.length = 0
    })

    it('should synchronize presence across multiple clients', async () => {
      const uniqueTopic = `${roomTopic}-multi-${Date.now()}`
      const numClients = 3

      // Create and connect all clients
      for (let i = 0; i < numClients; i++) {
        const client = new RealtimeClient(WS_URL, {
          heartbeatIntervalMs: 60000,
          logLevel: 'error',
        })
        client.connect()
        clients.push(client)
      }

      await new Promise((r) => setTimeout(r, 500))

      // All clients join and track sequentially with delays
      for (let i = 0; i < numClients; i++) {
        const channel = clients[i].channel(uniqueTopic, {
          config: { presence: { key: `user-${i}` } },
        })
        channels.push(channel)

        await waitForSubscribed(channel)
        await channel.track({ user: `User${i}`, index: i })

        // Wait between each client to ensure sync
        await new Promise((r) => setTimeout(r, 300))
      }

      // Wait for all syncs to propagate
      await new Promise((r) => setTimeout(r, 1000))

      // Last client should see all users (it joined last, so receives all presence_state)
      const lastClientState = channels[numClients - 1].presenceState()
      const keys = Object.keys(lastClientState)

      // At minimum, last client should see all previous clients
      expect(keys.length).toBeGreaterThanOrEqual(numClients - 1)

      // Verify we can see at least the first and second users
      expect(keys).toContain('user-0')
      expect(keys).toContain('user-1')
    })
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RealtimeClient } from '../RealtimeClient.js'

/**
 * Unit tests for RealtimeClient statistics functionality
 */
describe('RealtimeClient Statistics', () => {
  let client: RealtimeClient

  beforeEach(() => {
    client = new RealtimeClient('ws://localhost:9999')
  })

  describe('getStatistics()', () => {
    it('should return initial statistics with zero values', () => {
      const stats = client.getStatistics()

      // RTT should be zero initially
      expect(stats.rtt.current).toBe(0)
      expect(stats.rtt.avg).toBe(0)
      expect(stats.rtt.min).toBe(0)
      expect(stats.rtt.max).toBe(0)
      expect(stats.rtt.measurements).toBe(0)
      expect(stats.rtt.lastMeasurementTime).toBeNull()

      // Connection stats should be zero
      expect(stats.connection.attempts).toBe(0)
      expect(stats.connection.successes).toBe(0)
      expect(stats.connection.reconnects).toBe(0)
      expect(stats.connection.connectedAt).toBeNull()
      expect(stats.connection.totalConnectedTime).toBe(0)

      // Heartbeat stats should be zero
      expect(stats.heartbeat.sent).toBe(0)
      expect(stats.heartbeat.received).toBe(0)
      expect(stats.heartbeat.timeouts).toBe(0)

      // Message stats should be zero
      expect(stats.messages.sent).toBe(0)
      expect(stats.messages.received).toBe(0)
      expect(stats.messages.bytesSent).toBe(0)
      expect(stats.messages.bytesReceived).toBe(0)

      // Other stats
      expect(stats.sendBufferSize).toBe(0)
      expect(stats.channelCount).toBe(0)
      expect(stats.totalErrors).toBe(0)
      expect(stats.startTime).toBeGreaterThan(0)
      expect(stats.currentConnectionDuration).toBe(0)
    })

    it('should have startTime set to creation time', () => {
      const beforeCreate = Date.now()
      const newClient = new RealtimeClient('ws://localhost:9999')
      const afterCreate = Date.now()

      const stats = newClient.getStatistics()
      expect(stats.startTime).toBeGreaterThanOrEqual(beforeCreate)
      expect(stats.startTime).toBeLessThanOrEqual(afterCreate)
    })

    it('should track channel count', () => {
      expect(client.getStatistics().channelCount).toBe(0)

      client.channel('room:1')
      expect(client.getStatistics().channelCount).toBe(1)

      client.channel('room:2')
      expect(client.getStatistics().channelCount).toBe(2)

      // Getting same channel should not increase count
      client.channel('room:1')
      expect(client.getStatistics().channelCount).toBe(2)
    })
  })

  describe('resetStatistics()', () => {
    it('should reset all statistics to initial values', () => {
      // Create some channels to verify channelCount is NOT reset
      client.channel('room:1')
      client.channel('room:2')

      const beforeReset = Date.now()
      client.resetStatistics()
      const afterReset = Date.now()

      const stats = client.getStatistics()

      // Verify reset values
      expect(stats.rtt.current).toBe(0)
      expect(stats.rtt.avg).toBe(0)
      expect(stats.rtt.measurements).toBe(0)
      expect(stats.messages.sent).toBe(0)
      expect(stats.messages.received).toBe(0)
      expect(stats.messages.bytesSent).toBe(0)
      expect(stats.messages.bytesReceived).toBe(0)
      expect(stats.heartbeat.sent).toBe(0)
      expect(stats.heartbeat.received).toBe(0)
      expect(stats.heartbeat.timeouts).toBe(0)
      expect(stats.connection.attempts).toBe(0)
      expect(stats.connection.successes).toBe(0)
      expect(stats.totalErrors).toBe(0)

      // startTime should be updated to reset time
      expect(stats.startTime).toBeGreaterThanOrEqual(beforeReset)
      expect(stats.startTime).toBeLessThanOrEqual(afterReset)

      // channelCount should NOT be reset (it's a real-time metric)
      expect(stats.channelCount).toBe(2)
    })
  })

  describe('statistics structure', () => {
    it('should have correct nested structure', () => {
      const stats = client.getStatistics()

      // Verify structure
      expect(stats).toHaveProperty('rtt')
      expect(stats).toHaveProperty('connection')
      expect(stats).toHaveProperty('heartbeat')
      expect(stats).toHaveProperty('messages')
      expect(stats).toHaveProperty('sendBufferSize')
      expect(stats).toHaveProperty('channelCount')
      expect(stats).toHaveProperty('totalErrors')
      expect(stats).toHaveProperty('startTime')
      expect(stats).toHaveProperty('currentConnectionDuration')

      // Verify RTT structure
      expect(stats.rtt).toHaveProperty('current')
      expect(stats.rtt).toHaveProperty('avg')
      expect(stats.rtt).toHaveProperty('min')
      expect(stats.rtt).toHaveProperty('max')
      expect(stats.rtt).toHaveProperty('measurements')
      expect(stats.rtt).toHaveProperty('lastMeasurementTime')

      // Verify connection structure
      expect(stats.connection).toHaveProperty('attempts')
      expect(stats.connection).toHaveProperty('successes')
      expect(stats.connection).toHaveProperty('reconnects')
      expect(stats.connection).toHaveProperty('connectedAt')
      expect(stats.connection).toHaveProperty('totalConnectedTime')

      // Verify heartbeat structure
      expect(stats.heartbeat).toHaveProperty('sent')
      expect(stats.heartbeat).toHaveProperty('received')
      expect(stats.heartbeat).toHaveProperty('timeouts')

      // Verify messages structure
      expect(stats.messages).toHaveProperty('sent')
      expect(stats.messages).toHaveProperty('received')
      expect(stats.messages).toHaveProperty('bytesSent')
      expect(stats.messages).toHaveProperty('bytesReceived')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { encode, decode, createReply } from '../serializer.js'
import type { Message } from '../types.js'

describe('serializer', () => {
  describe('encode', () => {
    it('should encode message to JSON array string', () => {
      const message: Message = {
        join_seq: '1',
        seq: '2',
        topic: 'realtime:room1',
        event: 'broadcast',
        payload: { type: 'broadcast', event: 'msg', payload: { text: 'hello' } },
      }

      const result = encode(message)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual([
        '1',
        '2',
        'realtime:room1',
        'broadcast',
        { type: 'broadcast', event: 'msg', payload: { text: 'hello' } },
      ])
    })

    it('should handle null join_seq and seq', () => {
      const message: Message = {
        join_seq: null,
        seq: null,
        topic: '$system',
        event: 'heartbeat',
        payload: {},
      }

      const result = encode(message)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual([null, null, '$system', 'heartbeat', {}])
    })
  })

  describe('decode', () => {
    it('should decode valid JSON array to message', () => {
      const data = JSON.stringify(['1', '2', 'realtime:room1', 'broadcast', { text: 'hello' }])

      const result = decode(data)

      expect(result).toEqual({
        join_seq: '1',
        seq: '2',
        topic: 'realtime:room1',
        event: 'broadcast',
        payload: { text: 'hello' },
      })
    })

    it('should return null for invalid JSON', () => {
      const result = decode('not valid json')
      expect(result).toBeNull()
    })

    it('should return null for non-array JSON', () => {
      const result = decode('{"key": "value"}')
      expect(result).toBeNull()
    })

    it('should return null for array with wrong length', () => {
      const result = decode('["1", "2", "topic"]')
      expect(result).toBeNull()
    })

    it('should handle null values in array', () => {
      const data = JSON.stringify([null, '3', '$system', 'heartbeat', {}])

      const result = decode(data)

      expect(result).toEqual({
        join_seq: null,
        seq: '3',
        topic: '$system',
        event: 'heartbeat',
        payload: {},
      })
    })
  })

  describe('createReply', () => {
    it('should create ok reply message', () => {
      const result = createReply('1', 'realtime:room1', 'ok', { data: 'success' })

      expect(result).toEqual({
        join_seq: null,
        seq: '1',
        topic: 'realtime:room1',
        event: 'chan:reply',
        payload: {
          status: 'ok',
          response: { data: 'success' },
        },
      })
    })

    it('should create error reply message', () => {
      const result = createReply('2', 'realtime:room1', 'error', {
        code: 'AUTH_EXPIRED',
        reason: 'Token expired',
      })

      expect(result).toEqual({
        join_seq: null,
        seq: '2',
        topic: 'realtime:room1',
        event: 'chan:reply',
        payload: {
          status: 'error',
          response: {
            code: 'AUTH_EXPIRED',
            reason: 'Token expired',
          },
        },
      })
    })

    it('should use empty object as default response', () => {
      const result = createReply('3', 'realtime:room1', 'ok')

      expect(result.payload).toEqual({
        status: 'ok',
        response: {},
      })
    })
  })

  describe('encode/decode roundtrip', () => {
    it('should preserve message through encode and decode', () => {
      const original: Message = {
        join_seq: '1',
        seq: '5',
        topic: 'realtime:chat',
        event: 'broadcast',
        payload: {
          type: 'broadcast',
          event: 'message',
          payload: {
            text: 'Hello World!',
            userId: 'user-123',
            timestamp: 1234567890,
          },
        },
      }

      const encoded = encode(original)
      const decoded = decode(encoded)

      expect(decoded).toEqual(original)
    })
  })
})


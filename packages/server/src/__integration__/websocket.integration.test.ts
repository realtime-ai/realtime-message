import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { encode, decode } from '@realtime-message/shared'
import type { Message } from '@realtime-message/shared'

// 注意：运行此测试需要先启动服务器
// 可以通过环境变量 WS_URL 指定服务器地址

const WS_URL = process.env.WS_URL || 'ws://localhost:4000/realtime/v1/websocket'
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token'

describe.skip('WebSocket Integration Tests', () => {
  let ws: WebSocket | null = null
  let seq = 0

  const nextSeq = () => String(++seq)

  const sendMessage = (message: Message): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'))
        return
      }
      ws.send(encode(message), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  const waitForMessage = (
    predicate: (msg: Message) => boolean,
    timeout = 5000
  ): Promise<Message> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for message'))
      }, timeout)

      const handler = (data: WebSocket.RawData) => {
        const msg = decode(data.toString())
        if (msg && predicate(msg)) {
          clearTimeout(timer)
          ws?.off('message', handler)
          resolve(msg)
        }
      }

      ws?.on('message', handler)
    })
  }

  beforeEach(async () => {
    seq = 0
    ws = new WebSocket(WS_URL)

    await new Promise<void>((resolve, reject) => {
      ws!.on('open', () => resolve())
      ws!.on('error', reject)
    })
  })

  afterEach(() => {
    if (ws) {
      ws.close()
      ws = null
    }
  })

  describe('Connection', () => {
    it('should connect to WebSocket server', () => {
      expect(ws?.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('Channel Join', () => {
    it('should join a channel successfully', async () => {
      const joinSeq = nextSeq()

      await sendMessage({
        join_seq: joinSeq,
        seq: joinSeq,
        topic: 'realtime:test-room',
        event: 'chan:join',
        payload: {
          config: {
            broadcast: { self: true, ack: false },
            presence: { key: 'test-user', enabled: true },
          },
          access_token: TEST_TOKEN,
        },
      })

      const reply = await waitForMessage(
        (msg) => msg.event === 'chan:reply' && msg.seq === joinSeq
      )

      expect(reply.payload).toEqual({
        status: 'ok',
        response: expect.any(Object),
      })
    })

    it('should receive error for invalid token', async () => {
      const joinSeq = nextSeq()

      await sendMessage({
        join_seq: joinSeq,
        seq: joinSeq,
        topic: 'realtime:test-room',
        event: 'chan:join',
        payload: {
          config: {},
          access_token: 'invalid-token',
        },
      })

      const reply = await waitForMessage(
        (msg) => msg.event === 'chan:reply' && msg.seq === joinSeq
      )

      expect(reply.payload.status).toBe('error')
    })
  })

  describe('Heartbeat', () => {
    it('should respond to heartbeat', async () => {
      const heartbeatSeq = nextSeq()

      await sendMessage({
        join_seq: null,
        seq: heartbeatSeq,
        topic: '$system',
        event: 'heartbeat',
        payload: {},
      })

      const reply = await waitForMessage(
        (msg) => msg.event === 'chan:reply' && msg.seq === heartbeatSeq
      )

      expect(reply.payload).toEqual({
        status: 'ok',
        response: {},
      })
    })
  })

  describe('Broadcast', () => {
    it('should broadcast message to self when self=true', async () => {
      // First join the channel
      const joinSeq = nextSeq()
      await sendMessage({
        join_seq: joinSeq,
        seq: joinSeq,
        topic: 'realtime:broadcast-test',
        event: 'chan:join',
        payload: {
          config: { broadcast: { self: true } },
          access_token: TEST_TOKEN,
        },
      })

      await waitForMessage(
        (msg) => msg.event === 'chan:reply' && msg.seq === joinSeq
      )

      // Send broadcast
      const broadcastSeq = nextSeq()
      await sendMessage({
        join_seq: joinSeq,
        seq: broadcastSeq,
        topic: 'realtime:broadcast-test',
        event: 'broadcast',
        payload: {
          type: 'broadcast',
          event: 'test-event',
          payload: { message: 'hello' },
        },
      })

      // Should receive the broadcast back
      const broadcast = await waitForMessage(
        (msg) =>
          msg.event === 'broadcast' &&
          msg.payload.event === 'test-event'
      )

      expect(broadcast.payload.payload).toEqual({ message: 'hello' })
    })
  })
})


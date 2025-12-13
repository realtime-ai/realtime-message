import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import {
  CHANNEL_EVENTS,
  SYSTEM_TOPIC,
  encode,
  decode,
  type Message,
  type ReplyPayload,
  type JoinPayload,
  type BroadcastPayload,
  type PresencePayload,
} from '@realtime-message/shared'
import { ChannelManager } from './ChannelManager.js'
import { BroadcastHandler } from './BroadcastHandler.js'
import { PresenceManager } from './PresenceManager.js'
import { RedisAdapter } from './redis/RedisAdapter.js'
import { RedisPubSub } from './redis/RedisPubSub.js'
import { JwtVerifier } from './auth/JwtVerifier.js'

const PORT = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 4000
const UPSTASH_REDIS_REST_URL = process.env['UPSTASH_REDIS_REST_URL']
const UPSTASH_REDIS_REST_TOKEN = process.env['UPSTASH_REDIS_REST_TOKEN']
const AUTH_ENABLED = process.env['AUTH_ENABLED'] === 'true'
const AUTH_SECRET = process.env['AUTH_SECRET'] ?? 'your-secret-key-change-in-production'
const AUTH_ISSUER = process.env['AUTH_ISSUER']
const AUTH_AUDIENCE = process.env['AUTH_AUDIENCE']

// Hono app for HTTP routes
const app = new Hono()

// Channel manager instance
const channelManager = new ChannelManager()
const broadcastHandler = new BroadcastHandler(channelManager)
const presenceManager = new PresenceManager(channelManager)

// Optional Redis integration (Upstash)
let redisAdapter: RedisAdapter | null = null
let redisPubSub: RedisPubSub | null = null

if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
  redisAdapter = new RedisAdapter({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  })
  redisPubSub = new RedisPubSub(redisAdapter, channelManager)
  console.log(`Upstash Redis enabled`)
}

// Optional JWT authentication
let jwtVerifier: JwtVerifier | null = null

if (AUTH_ENABLED) {
  jwtVerifier = new JwtVerifier({
    secret: AUTH_SECRET,
    issuer: AUTH_ISSUER,
    audience: AUTH_AUDIENCE,
  })
  console.log('JWT authentication enabled')
}

app.get('/', (c) => {
  return c.json({ status: 'ok', message: 'Realtime Server' })
})

app.get('/health', (c) => {
  const stats = channelManager.getStats()
  return c.json({ status: 'healthy', ...stats })
})

// REST API: Broadcast endpoint
app.post('/api/broadcast', async (c) => {
  // Verify API key if auth is enabled
  if (jwtVerifier) {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401)
    }
    const token = authHeader.slice(7)
    const verifyResult = await jwtVerifier.verify(token)
    if (!verifyResult.valid) {
      return c.json({ error: verifyResult.error, code: verifyResult.errorCode }, 401)
    }
  }

  try {
    const body = await c.req.json() as {
      topic: string
      event: string
      payload: unknown
    }

    if (!body.topic || !body.event) {
      return c.json({ error: 'Missing topic or event' }, 400)
    }

    // Broadcast to local members
    const result = broadcastHandler.broadcast(
      body.topic,
      'api', // senderId
      null as unknown as WebSocket, // no sender WebSocket
      body.event,
      body.payload,
      { self: true } // always include all members
    )

    // Publish to Redis for other instances
    if (redisPubSub) {
      await redisPubSub.publishBroadcast(
        body.topic,
        'api',
        body.event,
        body.payload
      )
    }

    console.log(`[API] Broadcast to ${body.topic}: ${body.event}`)
    return c.json({ status: 'ok', recipientCount: result.recipientCount })
  } catch (error) {
    console.error('[API] Broadcast error:', error)
    return c.json({ error: 'Invalid request body' }, 400)
  }
})

// REST API: Get channel stats
app.get('/api/channels/:topic', (c) => {
  const topic = c.req.param('topic')
  const members = channelManager.getMembers(topic)
  return c.json({
    topic,
    memberCount: members.length,
    members: members.map((m) => ({ clientId: m.clientId })),
  })
})

// Client connection tracking
interface ClientConnection {
  id: string
  ws: WebSocket
}

const clients = new Map<WebSocket, ClientConnection>()
let clientIdCounter = 0

/**
 * Send reply to client
 */
function sendReply(
  ws: WebSocket,
  seq: string | null,
  topic: string,
  payload: ReplyPayload
): void {
  const msg: Message = {
    join_seq: null,
    seq,
    topic,
    event: CHANNEL_EVENTS.reply,
    payload,
  }
  ws.send(encode(msg))
}

/**
 * Handle incoming message
 */
async function handleMessage(client: ClientConnection, msg: Message): Promise<void> {
  const { topic, event, seq, payload } = msg

  console.log(`[${client.id}] Received: ${event} on ${topic}`)

  // Handle heartbeat
  if (topic === SYSTEM_TOPIC && event === CHANNEL_EVENTS.heartbeat) {
    sendReply(client.ws, seq, SYSTEM_TOPIC, {
      status: 'ok',
      response: {},
    })
    return
  }

  // Handle channel join
  if (event === CHANNEL_EVENTS.join) {
    const joinPayload = payload as JoinPayload

    // Verify JWT token if authentication is enabled
    if (jwtVerifier) {
      const token = joinPayload.access_token
      if (!token) {
        sendReply(client.ws, seq, topic, {
          status: 'error',
          response: { reason: 'Access token required', code: 'AUTH_TOKEN_REQUIRED' },
        })
        return
      }

      const verifyResult = await jwtVerifier.verify(token)
      if (!verifyResult.valid) {
        sendReply(client.ws, seq, topic, {
          status: 'error',
          response: { reason: verifyResult.error, code: verifyResult.errorCode },
        })
        return
      }

      // Check channel access permission
      if (!jwtVerifier.canAccessChannel(verifyResult.payload!, topic)) {
        sendReply(client.ws, seq, topic, {
          status: 'error',
          response: { reason: 'Access denied to this channel', code: 'AUTH_CHANNEL_DENIED' },
        })
        return
      }

      console.log(`[${client.id}] Authenticated as ${verifyResult.payload?.sub ?? 'unknown'}`)
    }

    const result = channelManager.join(
      topic,
      client.id,
      client.ws,
      seq ?? '0',
      joinPayload
    )

    if (result.success) {
      // Subscribe to Redis topic for cross-instance messages
      if (redisPubSub) {
        redisPubSub.subscribeTopic(topic).catch((err) => {
          console.error(`[Redis] Failed to subscribe to ${topic}:`, err)
        })
      }

      sendReply(client.ws, seq, topic, {
        status: 'ok',
        response: {},
      })

      // Send current presence state to the newly joined client
      presenceManager.sendState(topic, client.ws)
    } else {
      sendReply(client.ws, seq, topic, {
        status: 'error',
        response: { reason: result.error },
      })
    }
    return
  }

  // Handle channel leave
  if (event === CHANNEL_EVENTS.leave) {
    // Untrack presence before leaving
    presenceManager.untrack(topic, client.id)

    const result = channelManager.leave(topic, client.id)

    if (result.success) {
      sendReply(client.ws, seq, topic, {
        status: 'ok',
        response: {},
      })
    } else {
      sendReply(client.ws, seq, topic, {
        status: 'error',
        response: { reason: result.error },
      })
    }
    return
  }

  // Handle broadcast
  if (event === CHANNEL_EVENTS.broadcast) {
    const broadcastPayload = payload as BroadcastPayload
    const member = channelManager.getMember(topic, client.id)

    if (!member) {
      sendReply(client.ws, seq, topic, {
        status: 'error',
        response: { reason: 'Not joined to channel' },
      })
      return
    }

    // Broadcast to local members
    const result = broadcastHandler.broadcast(
      topic,
      client.id,
      client.ws,
      broadcastPayload.event,
      broadcastPayload.payload,
      { self: member.config.broadcast.self }
    )

    // Publish to Redis for other instances
    if (redisPubSub) {
      redisPubSub.publishBroadcast(
        topic,
        client.id,
        broadcastPayload.event,
        broadcastPayload.payload
      ).catch((err) => {
        console.error(`[Redis] Failed to publish broadcast:`, err)
      })
    }

    // Send ack if requested
    if (member.config.broadcast.ack && seq) {
      sendReply(client.ws, seq, topic, {
        status: result.success ? 'ok' : 'error',
        response: result.success
          ? { recipientCount: result.recipientCount }
          : { reason: result.error },
      })
    }
    return
  }

  // Handle presence track/untrack
  if (event === 'presence') {
    const presencePayload = payload as PresencePayload
    const member = channelManager.getMember(topic, client.id)

    if (!member) {
      sendReply(client.ws, seq, topic, {
        status: 'error',
        response: { reason: 'Not joined to channel' },
      })
      return
    }

    if (presencePayload.event === 'track') {
      const trackPayload = presencePayload.payload as { key?: string; meta?: Record<string, unknown> }
      const key = trackPayload?.key ?? member.config.presence.key ?? client.id
      const meta = trackPayload?.meta ?? {}

      const result = presenceManager.track(topic, client.id, key, meta)

      sendReply(client.ws, seq, topic, {
        status: result.success ? 'ok' : 'error',
        response: result.success ? {} : { reason: result.error },
      })
    } else if (presencePayload.event === 'untrack') {
      const untrackPayload = presencePayload.payload as { key?: string } | undefined
      const key = untrackPayload?.key

      const result = presenceManager.untrack(topic, client.id, key)

      sendReply(client.ws, seq, topic, {
        status: result.success ? 'ok' : 'error',
        response: result.success ? {} : { reason: result.error },
      })
    }
    return
  }

  // Handle presence_state request
  if (event === CHANNEL_EVENTS.presence_state) {
    presenceManager.sendState(topic, client.ws)
    return
  }

  // Unknown event
  console.log(`[${client.id}] Unknown event: ${event}`)
}

// Start HTTP server
const server = serve({
  fetch: app.fetch,
  port: PORT,
}) as Server

console.log(`HTTP server running on http://localhost:${PORT}`)

// Create WebSocket server
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  const clientId = `client-${++clientIdCounter}`
  const client: ClientConnection = {
    id: clientId,
    ws,
  }
  clients.set(ws, client)

  console.log(`[${clientId}] Connected. Total clients: ${clients.size}`)

  ws.on('message', (data) => {
    const message = decode(data.toString())
    if (!message) {
      console.error(`[${clientId}] Invalid message format`)
      return
    }
    handleMessage(client, message)
  })

  ws.on('close', (code, reason) => {
    console.log(`[${clientId}] Disconnected. Code: ${code}, Reason: ${reason.toString()}`)
    // Remove from all presences
    presenceManager.handleDisconnect(clientId)
    // Remove from all channels
    channelManager.leaveAll(clientId)
    clients.delete(ws)
  })

  ws.on('error', (error) => {
    console.error(`[${clientId}] Error:`, error)
  })
})

console.log(`WebSocket server running on ws://localhost:${PORT}`)

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  wss.close()
  server.close()
  if (redisAdapter) {
    await redisAdapter.close()
  }
  process.exit(0)
})

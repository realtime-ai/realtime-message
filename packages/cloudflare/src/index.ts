import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types.js'

// Re-export Durable Objects
export { RealtimeChannel } from './durable-objects/RealtimeChannel.js'
export { RealtimeGateway } from './durable-objects/RealtimeGateway.js'

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('*', cors())

// Health check (only for non-WebSocket requests)
app.get('/', (c) => {
  const upgradeHeader = c.req.header('Upgrade')

  // Handle WebSocket upgrade - route to Gateway
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    const id = c.env.REALTIME_GATEWAY.idFromName('default')
    const stub = c.env.REALTIME_GATEWAY.get(id)
    return stub.fetch(c.req.raw)
  }

  // Regular HTTP request - return health check
  return c.json({
    name: 'realtime-message',
    version: '0.0.1',
    runtime: 'cloudflare-workers',
  })
})

// WebSocket connection endpoint
// GET /realtime/:topic
app.get('/realtime/:topic', async (c) => {
  const topic = c.req.param('topic')
  const upgradeHeader = c.req.header('Upgrade')

  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
  }

  // Route to Durable Object
  const id = c.env.REALTIME_CHANNEL.idFromName(topic)
  const stub = c.env.REALTIME_CHANNEL.get(id)

  // Forward the request to the Durable Object
  const url = new URL(c.req.url)
  url.pathname = `/realtime/${topic}`

  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
  }))
})

// Broadcast to a channel via HTTP API
// POST /api/channels/:topic/broadcast
app.post('/api/channels/:topic/broadcast', async (c) => {
  const topic = c.req.param('topic')

  // Route to Durable Object
  const id = c.env.REALTIME_CHANNEL.idFromName(topic)
  const stub = c.env.REALTIME_CHANNEL.get(id)

  const body = await c.req.json()
  const url = new URL(c.req.url)
  url.pathname = `/realtime/${topic}/broadcast`

  const response = await stub.fetch(new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  return response
})

// Get presence state for a channel
// GET /api/channels/:topic/presence
app.get('/api/channels/:topic/presence', async (c) => {
  const topic = c.req.param('topic')

  // Route to Durable Object
  const id = c.env.REALTIME_CHANNEL.idFromName(topic)
  const stub = c.env.REALTIME_CHANNEL.get(id)

  const url = new URL(c.req.url)
  url.pathname = `/realtime/${topic}/presence`

  const response = await stub.fetch(new Request(url.toString(), {
    method: 'GET',
  }))

  return response
})

// Get channel stats
// GET /api/channels/:topic/stats
app.get('/api/channels/:topic/stats', async (c) => {
  const topic = c.req.param('topic')

  // Route to Durable Object
  const id = c.env.REALTIME_CHANNEL.idFromName(topic)
  const stub = c.env.REALTIME_CHANNEL.get(id)

  const url = new URL(c.req.url)
  url.pathname = `/realtime/${topic}/stats`

  const response = await stub.fetch(new Request(url.toString(), {
    method: 'GET',
  }))

  return response
})

// Export the worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },
}

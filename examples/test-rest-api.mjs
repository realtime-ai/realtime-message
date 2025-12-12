/**
 * Test script for Iteration 8: REST API
 *
 * This test verifies:
 * 1. HTTP broadcast API
 * 2. Channel stats API
 *
 * Run: npm run dev:server && node examples/test-rest-api.mjs
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const ROOM_TOPIC = 'room:rest-api-test'
const SERVER_URL = 'http://localhost:4000'

console.log('=== Iteration 8: REST API Test ===\n')

// Track events
const messagesReceived = []

// Create WebSocket client to receive broadcasts
const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

// Connect
console.log('--- Step 1: Connect WebSocket Client ---')
client.connect()
await new Promise((r) => setTimeout(r, 500))

if (!client.isConnected()) {
  console.error('Failed to connect. Ensure server is running.')
  process.exit(1)
}

// Subscribe to channel
const channel = client.channel(ROOM_TOPIC, {
  config: { broadcast: { self: true } },
})

channel.on('broadcast', { event: 'notification' }, (payload) => {
  console.log(`[WebSocket] Received: ${JSON.stringify(payload.payload)}`)
  messagesReceived.push(payload)
})

await new Promise((resolve) => {
  channel.subscribe((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      console.log('[WebSocket] Subscribed to channel')
      resolve()
    }
  })
})

// Test 1: GET channel stats (should show 1 member)
console.log('\n--- Test 1: GET /api/channels/:topic ---')
const statsResponse = await fetch(`${SERVER_URL}/api/channels/${encodeURIComponent(ROOM_TOPIC)}`)
const stats = await statsResponse.json()
console.log(`Channel stats: ${JSON.stringify(stats)}`)

// Test 2: POST broadcast without auth (should work when auth disabled)
console.log('\n--- Test 2: POST /api/broadcast ---')
const broadcastResponse = await fetch(`${SERVER_URL}/api/broadcast`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: ROOM_TOPIC,
    event: 'notification',
    payload: { message: 'Hello from REST API!', timestamp: Date.now() },
  }),
})
const broadcastResult = await broadcastResponse.json()
console.log(`Broadcast result: ${JSON.stringify(broadcastResult)}`)

// Wait for message to be received
await new Promise((r) => setTimeout(r, 500))

// Test 3: Missing topic/event (should fail)
console.log('\n--- Test 3: Invalid request (missing fields) ---')
const invalidResponse = await fetch(`${SERVER_URL}/api/broadcast`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: 'test' }),
})
const invalidResult = await invalidResponse.json()
console.log(`Invalid request result: ${JSON.stringify(invalidResult)} (status: ${invalidResponse.status})`)

// Summary
console.log('\n=== Summary ===')
console.log(`Channel members: ${stats.memberCount}`)
console.log(`Messages received via WebSocket: ${messagesReceived.length}`)

// Verification
console.log('\n--- Verification ---')
const tests = [
  { test: 'Channel stats API works', passed: stats.memberCount === 1 },
  { test: 'Broadcast API returns success', passed: broadcastResult.status === 'ok' },
  { test: 'WebSocket receives HTTP broadcast', passed: messagesReceived.length > 0 },
  { test: 'Invalid request returns 400', passed: invalidResponse.status === 400 },
]

tests.forEach((t) => console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`))

const allPassed = tests.every((t) => t.passed)
console.log(`\n${allPassed ? 'PASSED' : 'FAILED'}`)

// Cleanup
await client.removeAllChannels()
client.disconnect()

process.exit(allPassed ? 0 : 1)

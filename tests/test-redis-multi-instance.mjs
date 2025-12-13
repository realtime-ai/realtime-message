/**
 * Test script for Iteration 5: Redis Multi-Instance Support
 *
 * This test requires:
 * 1. Redis server running on localhost:6379
 * 2. Two server instances running with REDIS_ENABLED=true:
 *    - Terminal 1: REDIS_ENABLED=true PORT=4000 npm run dev:server
 *    - Terminal 2: REDIS_ENABLED=true PORT=4001 npm run dev:server
 *
 * Then run this test: node examples/test-redis-multi-instance.mjs
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const ROOM_TOPIC = 'room:multi-instance-test'

console.log('=== Iteration 5: Redis Multi-Instance Test ===\n')
console.log('NOTE: Make sure you have:')
console.log('  1. Redis running on localhost:6379')
console.log('  2. Server on port 4000: REDIS_ENABLED=true PORT=4000 npm run dev:server')
console.log('  3. Server on port 4001: REDIS_ENABLED=true PORT=4001 npm run dev:server')
console.log('')

// Track received messages
const receivedByA = []
const receivedByB = []

// Create two clients connected to DIFFERENT server instances
const clientA = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

const clientB = new RealtimeClient('ws://localhost:4001', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

// Connect both clients
console.log('--- Connecting clients ---')
clientA.connect()
clientB.connect()

await new Promise((resolve) => setTimeout(resolve, 1000))

if (!clientA.isConnected()) {
  console.error('[Client A] Failed to connect to ws://localhost:4000')
  console.error('Please make sure server is running with: REDIS_ENABLED=true PORT=4000 npm run dev:server')
  process.exit(1)
}

if (!clientB.isConnected()) {
  console.error('[Client B] Failed to connect to ws://localhost:4001')
  console.error('Please make sure server is running with: REDIS_ENABLED=true PORT=4001 npm run dev:server')
  process.exit(1)
}

console.log('[Client A] Connected to server on port 4000')
console.log('[Client B] Connected to server on port 4001')

// Create channels
const channelA = clientA.channel(ROOM_TOPIC)
const channelB = clientB.channel(ROOM_TOPIC)

// Setup broadcast listeners
channelA.on('broadcast', { event: 'message' }, (payload) => {
  console.log('[Client A] Received:', payload.payload)
  receivedByA.push(payload)
})

channelB.on('broadcast', { event: 'message' }, (payload) => {
  console.log('[Client B] Received:', payload.payload)
  receivedByB.push(payload)
})

// Subscribe both clients
console.log('\n--- Subscribing both clients ---')

await new Promise((resolve) => {
  let count = 0
  const done = () => {
    count++
    if (count === 2) resolve()
  }

  channelA.subscribe((status) => {
    console.log(`[Client A] Subscribe status: ${status}`)
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) done()
  })

  channelB.subscribe((status) => {
    console.log(`[Client B] Subscribe status: ${status}`)
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) done()
  })
})

await new Promise((resolve) => setTimeout(resolve, 500))

// Test: Client A sends message to B (cross-instance via Redis)
console.log('\n--- Test: Cross-Instance Broadcast ---')
console.log('[Client A] Sending message to all members (via Redis pub/sub)...')

await channelA.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello from Server 4000!', timestamp: Date.now() },
})

// Wait for message to propagate through Redis
await new Promise((resolve) => setTimeout(resolve, 1000))

// Test: Client B sends message to A
console.log('[Client B] Sending message to all members (via Redis pub/sub)...')

await channelB.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello from Server 4001!', timestamp: Date.now() },
})

await new Promise((resolve) => setTimeout(resolve, 1000))

// Summary
console.log('\n--- Summary ---')
console.log(`Client A received ${receivedByA.length} messages:`)
receivedByA.forEach((msg, i) => {
  console.log(`  ${i + 1}. ${msg.payload?.text}`)
})

console.log(`Client B received ${receivedByB.length} messages:`)
receivedByB.forEach((msg, i) => {
  console.log(`  ${i + 1}. ${msg.payload?.text}`)
})

// Verification
console.log('\n--- Verification ---')
const testsPassed = []

// A should receive B's message (from server 4001)
const aReceivedFromB = receivedByA.some((m) => m.payload?.text?.includes('4001'))
testsPassed.push({ test: 'A receives message from server 4001', passed: aReceivedFromB })

// B should receive A's message (from server 4000)
const bReceivedFromA = receivedByB.some((m) => m.payload?.text?.includes('4000'))
testsPassed.push({ test: 'B receives message from server 4000', passed: bReceivedFromA })

testsPassed.forEach((t) => {
  console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`)
})

const allPassed = testsPassed.every((t) => t.passed)
console.log(`\nCross-instance messaging ${allPassed ? 'PASSED' : 'FAILED'}!`)

if (!allPassed) {
  console.log('\nIf tests failed, verify:')
  console.log('  1. Redis is running: redis-cli ping')
  console.log('  2. Both servers have REDIS_ENABLED=true')
}

// Cleanup
console.log('\n--- Cleanup ---')
await clientA.removeAllChannels()
await clientB.removeAllChannels()
clientA.disconnect()
clientB.disconnect()

console.log('\n=== Test Complete ===')
process.exit(allPassed ? 0 : 1)

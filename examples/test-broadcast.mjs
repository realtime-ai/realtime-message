/**
 * Test script for Iteration 3: Broadcast messaging
 * Tests two clients communicating through broadcast
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const ROOM_TOPIC = 'room:broadcast-test'

console.log('=== Iteration 3: Broadcast Test ===\n')

// Create two clients
const clientA = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

const clientB = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

// Track received messages
const receivedByA = []
const receivedByB = []

// Connect both clients
clientA.connect()
clientB.connect()

await new Promise((resolve) => setTimeout(resolve, 1000))

// Create channels for both clients
const channelA = clientA.channel(ROOM_TOPIC)
const channelB = clientB.channel(ROOM_TOPIC, {
  config: { broadcast: { self: true } }, // B receives its own messages
})

// Setup broadcast listeners BEFORE subscribing
channelA.on('broadcast', { event: 'message' }, (payload) => {
  console.log('[Client A] Received broadcast:', payload)
  receivedByA.push(payload)
})

channelB.on('broadcast', { event: 'message' }, (payload) => {
  console.log('[Client B] Received broadcast:', payload)
  receivedByB.push(payload)
})

// Also listen for all events on B
channelB.on('broadcast', {}, (payload) => {
  if (payload.event !== 'message') {
    console.log('[Client B] Received other broadcast:', payload)
  }
})

// Subscribe both clients
console.log('--- Subscribing both clients ---')

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

// Test 1: Client A sends message to B
console.log('\n--- Test 1: Client A sends message ---')
const result1 = await channelA.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello from A!', timestamp: Date.now() },
})
console.log(`[Client A] Send result: ${result1.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Test 2: Client B sends message (should receive its own due to self=true)
console.log('\n--- Test 2: Client B sends message (self=true) ---')
const result2 = await channelB.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello from B!', timestamp: Date.now() },
})
console.log(`[Client B] Send result: ${result2.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Test 3: Send a different event type
console.log('\n--- Test 3: Different event type ---')
await channelA.send({
  type: 'broadcast',
  event: 'typing',
  payload: { user: 'A', isTyping: true },
})

await new Promise((resolve) => setTimeout(resolve, 500))

// Summary
console.log('\n--- Summary ---')
console.log(`Client A received ${receivedByA.length} messages:`)
receivedByA.forEach((msg, i) => {
  console.log(`  ${i + 1}. ${msg.event}: ${JSON.stringify(msg.payload)}`)
})

console.log(`Client B received ${receivedByB.length} messages:`)
receivedByB.forEach((msg, i) => {
  console.log(`  ${i + 1}. ${msg.event}: ${JSON.stringify(msg.payload)}`)
})

// Verify
console.log('\n--- Verification ---')
const testsPassed = []

// A should receive B's message
const aReceivedFromB = receivedByA.some((m) => m.payload?.text === 'Hello from B!')
testsPassed.push({ test: 'A receives B\'s message', passed: aReceivedFromB })

// B should receive A's message
const bReceivedFromA = receivedByB.some((m) => m.payload?.text === 'Hello from A!')
testsPassed.push({ test: 'B receives A\'s message', passed: bReceivedFromA })

// B should receive its own message (self=true)
const bReceivedSelf = receivedByB.some((m) => m.payload?.text === 'Hello from B!')
testsPassed.push({ test: 'B receives own message (self=true)', passed: bReceivedSelf })

// A should NOT receive its own message (self=false by default)
const aReceivedSelf = receivedByA.some((m) => m.payload?.text === 'Hello from A!')
testsPassed.push({ test: 'A does NOT receive own message', passed: !aReceivedSelf })

testsPassed.forEach((t) => {
  console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`)
})

const allPassed = testsPassed.every((t) => t.passed)
console.log(`\nAll tests ${allPassed ? 'PASSED' : 'FAILED'}!`)

// Cleanup
console.log('\n--- Cleanup ---')
await clientA.removeAllChannels()
await clientB.removeAllChannels()
clientA.disconnect()
clientB.disconnect()

console.log('\n=== Test Complete ===')
process.exit(allPassed ? 0 : 1)

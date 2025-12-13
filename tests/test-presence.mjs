/**
 * Test script for Iteration 4: Presence (online status tracking)
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const ROOM_TOPIC = 'room:presence-test'

console.log('=== Iteration 4: Presence Test ===\n')

// Track events for verification
const eventsA = { syncs: 0, joins: [], leaves: [] }
const eventsB = { syncs: 0, joins: [], leaves: [] }

// Create two clients
const clientA = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

const clientB = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'warn',
})

// Connect both clients
clientA.connect()
clientB.connect()

await new Promise((resolve) => setTimeout(resolve, 1000))

// Create channels with presence key
const channelA = clientA.channel(ROOM_TOPIC, {
  config: { presence: { key: 'user-A' } },
})

const channelB = clientB.channel(ROOM_TOPIC, {
  config: { presence: { key: 'user-B' } },
})

// Setup presence listeners BEFORE subscribing
channelA.on('presence', { event: 'sync' }, () => {
  eventsA.syncs++
  console.log('[Client A] Presence sync, state:', Object.keys(channelA.presenceState()))
})

channelA.on('presence', { event: 'join' }, (payload) => {
  console.log(`[Client A] Join: ${payload.key}`)
  eventsA.joins.push(payload.key)
})

channelA.on('presence', { event: 'leave' }, (payload) => {
  console.log(`[Client A] Leave: ${payload.key}`)
  eventsA.leaves.push(payload.key)
})

channelB.on('presence', { event: 'sync' }, () => {
  eventsB.syncs++
  console.log('[Client B] Presence sync, state:', Object.keys(channelB.presenceState()))
})

channelB.on('presence', { event: 'join' }, (payload) => {
  console.log(`[Client B] Join: ${payload.key}`)
  eventsB.joins.push(payload.key)
})

channelB.on('presence', { event: 'leave' }, (payload) => {
  console.log(`[Client B] Leave: ${payload.key}`)
  eventsB.leaves.push(payload.key)
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

// Test 1: Client A tracks presence
console.log('\n--- Test 1: Client A tracks presence ---')
const trackResultA = await channelA.track({ user_id: 'A', status: 'online' })
console.log(`[Client A] Track result: ${trackResultA.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Test 2: Client B tracks presence
console.log('\n--- Test 2: Client B tracks presence ---')
const trackResultB = await channelB.track({ user_id: 'B', status: 'away' })
console.log(`[Client B] Track result: ${trackResultB.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Check presence state
console.log('\n--- Presence State Check ---')
const stateA = channelA.presenceState()
const stateB = channelB.presenceState()
console.log('[Client A] sees:', Object.keys(stateA))
console.log('[Client B] sees:', Object.keys(stateB))

// Test 3: Client A untracks
console.log('\n--- Test 3: Client A untracks ---')
const untrackResultA = await channelA.untrack()
console.log(`[Client A] Untrack result: ${untrackResultA.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Check presence state after untrack
console.log('\n--- Final Presence State ---')
const finalStateA = channelA.presenceState()
const finalStateB = channelB.presenceState()
console.log('[Client A] sees:', Object.keys(finalStateA))
console.log('[Client B] sees:', Object.keys(finalStateB))

// Summary
console.log('\n--- Summary ---')
console.log(`Client A events: ${eventsA.syncs} syncs, joins=[${eventsA.joins}], leaves=[${eventsA.leaves}]`)
console.log(`Client B events: ${eventsB.syncs} syncs, joins=[${eventsB.joins}], leaves=[${eventsB.leaves}]`)

// Verification
console.log('\n--- Verification ---')
const testsPassed = []

// A should track successfully
testsPassed.push({ test: 'A tracks successfully', passed: trackResultA.status === 'ok' })

// B should track successfully
testsPassed.push({ test: 'B tracks successfully', passed: trackResultB.status === 'ok' })

// B should see A join
testsPassed.push({ test: 'B sees A join', passed: eventsB.joins.includes('user-A') })

// A should see B join
testsPassed.push({ test: 'A sees B join', passed: eventsA.joins.includes('user-B') })

// B should see A leave after untrack
testsPassed.push({ test: 'B sees A leave', passed: eventsB.leaves.includes('user-A') })

// A should still see B (since B is still tracked)
testsPassed.push({
  test: 'A still sees B',
  passed: Object.keys(finalStateA).includes('user-B')
})

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

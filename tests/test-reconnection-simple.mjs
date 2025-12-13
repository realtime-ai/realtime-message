/**
 * Simple Reconnection Test for Iteration 7
 *
 * This test verifies reconnection logic by:
 * 1. Connecting and subscribing to a channel
 * 2. Simulating a connection drop by manually closing the socket
 * 3. Verifying auto-reconnect and auto-rejoin
 *
 * Run: npm run dev:server && node examples/test-reconnection-simple.mjs
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const ROOM_TOPIC = 'room:reconnect-simple'

console.log('=== Simple Reconnection Test ===\n')

// Track events
const events = {
  connected: 0,
  disconnected: 0,
  channelJoined: 0,
  messagesReceived: [],
}

// Create client
const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'info',
  reconnectAfterMs: (tries) => {
    // Fast reconnect for testing
    return Math.min(tries * 500, 2000)
  },
})

// Track events
client.onOpen(() => {
  events.connected++
  console.log(`[Event] Connected (total: ${events.connected})`)
})

client.onClose(() => {
  events.disconnected++
  console.log(`[Event] Disconnected (total: ${events.disconnected})`)
})

// Connect
console.log('--- Step 1: Connect ---')
client.connect()
await new Promise((r) => setTimeout(r, 500))

if (!client.isConnected()) {
  console.error('Failed to connect. Ensure server is running.')
  process.exit(1)
}

// Subscribe to channel
console.log('\n--- Step 2: Subscribe to Channel ---')
const channel = client.channel(ROOM_TOPIC, {
  config: { broadcast: { self: true, ack: true } },
})

channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log(`[Broadcast] ${JSON.stringify(payload.payload)}`)
  events.messagesReceived.push(payload)
})

await new Promise((resolve) => {
  channel.subscribe((status) => {
    console.log(`[Channel] Status: ${status}`)
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      events.channelJoined++
      resolve()
    }
  })
})

// Track presence
console.log('\n--- Step 3: Track Presence ---')
await channel.track({ user: 'test-user', status: 'online' })
console.log('[Presence] Tracked')

// Send message before disconnect
console.log('\n--- Step 4: Send Message ---')
await channel.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Before disconnect' },
})
await new Promise((r) => setTimeout(r, 300))

// Force close connection to trigger reconnect
console.log('\n--- Step 5: Force Disconnect (simulate network drop) ---')
// Access internal connection and close it
const internalConn = client['conn']
if (internalConn) {
  // Use a valid code but set closeWasClean to false manually to trigger reconnect
  client['closeWasClean'] = false
  // Close with a valid code - the reconnect is triggered by closeWasClean being false
  internalConn.close(4000, 'simulated disconnect')
}

// Wait for reconnection
console.log('[Waiting] For auto-reconnect...')
await new Promise((resolve) => {
  const checkInterval = setInterval(() => {
    if (events.connected >= 2 && events.channelJoined >= 2) {
      clearInterval(checkInterval)
      resolve()
    }
  }, 200)
  setTimeout(() => {
    clearInterval(checkInterval)
    resolve()
  }, 8000)
})

await new Promise((r) => setTimeout(r, 500))

// Send message after reconnect
console.log('\n--- Step 6: Send Message After Reconnect ---')
if (channel.isJoined()) {
  await channel.send({
    type: 'broadcast',
    event: 'message',
    payload: { text: 'After reconnect' },
  })
  await new Promise((r) => setTimeout(r, 300))
}

// Summary
console.log('\n=== Summary ===')
console.log(`Connected: ${events.connected} times`)
console.log(`Disconnected: ${events.disconnected} times`)
console.log(`Channel joined: ${events.channelJoined} times`)
console.log(`Messages received: ${events.messagesReceived.length}`)

// Verification
console.log('\n--- Verification ---')
const tests = [
  { test: 'Auto-reconnect triggered', passed: events.connected >= 2 },
  { test: 'Channel auto-rejoined', passed: events.channelJoined >= 2 },
  { test: 'Received message after reconnect', passed: events.messagesReceived.some((m) => m.payload?.text?.includes('After')) },
]

tests.forEach((t) => console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`))

const allPassed = tests.every((t) => t.passed)
console.log(`\n${allPassed ? 'PASSED' : 'FAILED'}`)

// Cleanup
client.disconnect()
process.exit(allPassed ? 0 : 1)

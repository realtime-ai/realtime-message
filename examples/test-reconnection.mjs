/**
 * Test script for Iteration 7: Reconnection & Fault Tolerance
 *
 * This test demonstrates:
 * 1. Auto-reconnect when connection is lost
 * 2. Auto-rejoin channels after reconnect
 * 3. Auto-restore presence tracking after reconnect
 *
 * How to test:
 * 1. Start server: npm run dev:server
 * 2. Run this test: node examples/test-reconnection.mjs
 * 3. Watch as the test simulates disconnection and reconnection
 *
 * Note: This test uses server restart to simulate disconnection.
 * In production, disconnection could happen due to network issues.
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'
import { spawn } from 'child_process'

const ROOM_TOPIC = 'room:reconnect-test'

console.log('=== Iteration 7: Reconnection Test ===\n')

// Track events
const events = {
  connected: 0,
  disconnected: 0,
  channelJoined: 0,
  messagesReceived: [],
  presenceRestored: false,
}

// Create client with short reconnect intervals for testing
const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 60000,
  logLevel: 'info',
  reconnectAfterMs: (tries) => {
    // Fast reconnect for testing: 500ms, 1s, 2s
    const intervals = [500, 1000, 2000]
    return intervals[tries - 1] ?? 2000
  },
})

// Track connection events
client.onOpen(() => {
  events.connected++
  console.log(`\n[Client] Connected (${events.connected} time(s))`)
})

client.onClose((event) => {
  events.disconnected++
  console.log(`[Client] Disconnected (${events.disconnected} time(s)). Code: ${event.code}`)
})

client.onError((error) => {
  console.log(`[Client] Error: ${error.message}`)
})

// Connect
console.log('--- Step 1: Initial Connection ---')
client.connect()
await new Promise((resolve) => setTimeout(resolve, 1000))

if (!client.isConnected()) {
  console.error('Failed to connect. Make sure server is running with: npm run dev:server')
  process.exit(1)
}

// Create channel and subscribe
console.log('\n--- Step 2: Subscribe to Channel ---')
const channel = client.channel(ROOM_TOPIC, {
  config: {
    broadcast: { self: true, ack: true },
    presence: { key: 'user-1' },
  },
})

// Setup broadcast listener
channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log(`[Channel] Received broadcast: ${JSON.stringify(payload.payload)}`)
  events.messagesReceived.push(payload)
})

// Setup presence listener
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState()
  const userCount = Object.keys(state).length
  console.log(`[Channel] Presence sync - ${userCount} user(s) online`)
  if (events.connected > 1 && userCount > 0) {
    events.presenceRestored = true
  }
})

// Subscribe
await new Promise((resolve) => {
  channel.subscribe((status) => {
    console.log(`[Channel] Subscribe status: ${status}`)
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      events.channelJoined++
      resolve()
    }
  })
})

// Track presence
console.log('\n--- Step 3: Track Presence ---')
const trackResult = await channel.track({ user_id: 'user-1', status: 'online' })
console.log(`[Channel] Track result: ${trackResult.status}`)

// Send a test message
console.log('\n--- Step 4: Send Test Message ---')
const sendResult = await channel.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello before disconnect!' },
})
console.log(`[Channel] Send result: ${sendResult.status}`)

await new Promise((resolve) => setTimeout(resolve, 500))

// Simulate disconnection by stopping and restarting server
console.log('\n--- Step 5: Simulating Server Restart ---')
console.log('[Test] Stopping server...')

// Kill the server
const killResult = await new Promise((resolve) => {
  const kill = spawn('pkill', ['-f', 'tsx watch'], { shell: true })
  kill.on('close', () => resolve(true))
  setTimeout(() => resolve(false), 2000)
})

console.log('[Test] Server stopped. Waiting for client to detect disconnection...')
await new Promise((resolve) => setTimeout(resolve, 2000))

console.log('[Test] Restarting server...')

// Restart server in background
const serverProcess = spawn('npm', ['run', 'dev:server'], {
  cwd: '/Users/leeoxiang/Code/realtime-message2',
  shell: true,
  detached: true,
  stdio: 'ignore',
})
serverProcess.unref()

// Wait for server to start
await new Promise((resolve) => setTimeout(resolve, 3000))

console.log('[Test] Server restarted. Waiting for client to reconnect...')

// Wait for reconnection
await new Promise((resolve) => {
  const checkInterval = setInterval(() => {
    if (events.connected > 1 && events.channelJoined > 1) {
      clearInterval(checkInterval)
      resolve()
    }
  }, 500)
  // Timeout after 10 seconds
  setTimeout(() => {
    clearInterval(checkInterval)
    resolve()
  }, 10000)
})

await new Promise((resolve) => setTimeout(resolve, 1000))

// Send another message after reconnection
console.log('\n--- Step 6: Send Message After Reconnect ---')
if (channel.isJoined()) {
  const sendResult2 = await channel.send({
    type: 'broadcast',
    event: 'message',
    payload: { text: 'Hello after reconnect!' },
  })
  console.log(`[Channel] Send result: ${sendResult2.status}`)
  await new Promise((resolve) => setTimeout(resolve, 500))
}

// Summary
console.log('\n=== Test Summary ===')
console.log(`Total connections: ${events.connected}`)
console.log(`Total disconnections: ${events.disconnected}`)
console.log(`Channel join count: ${events.channelJoined}`)
console.log(`Messages received: ${events.messagesReceived.length}`)
console.log(`Presence restored: ${events.presenceRestored}`)

// Verification
console.log('\n--- Verification ---')
const tests = [
  {
    test: 'Client reconnected automatically',
    passed: events.connected >= 2,
  },
  {
    test: 'Channel rejoined after reconnect',
    passed: events.channelJoined >= 2,
  },
  {
    test: 'Messages received after reconnect',
    passed: events.messagesReceived.some((m) => m.payload?.text?.includes('after')),
  },
]

tests.forEach((t) => {
  console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`)
})

const allPassed = tests.every((t) => t.passed)
console.log(`\nReconnection tests ${allPassed ? 'PASSED' : 'FAILED'}!`)

// Cleanup
console.log('\n--- Cleanup ---')
await client.removeAllChannels()
client.disconnect()

console.log('\n=== Test Complete ===')
process.exit(allPassed ? 0 : 1)

/**
 * Test script for Iteration 2: Channel subscribe/unsubscribe
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'

const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 30000, // 30s heartbeat to reduce noise
  logLevel: 'info',
})

console.log('=== Iteration 2: Channel Test ===\n')

// Connect to server
client.onOpen(() => {
  console.log('[Client] Connected to server')
})

client.onClose((event) => {
  console.log(`[Client] Disconnected: ${event.code} ${event.reason}`)
})

client.onError((error) => {
  console.error('[Client] Error:', error.message)
})

client.connect()

// Wait for connection
await new Promise((resolve) => setTimeout(resolve, 1000))

// Test 1: Subscribe to a channel
console.log('\n--- Test 1: Subscribe to channel ---')
const channel = client.channel('room:test-123')

channel.subscribe((status, error) => {
  if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
    console.log('[Channel] Subscribed successfully!')
  } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
    console.error('[Channel] Subscribe error:', error?.message)
  } else if (status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
    console.error('[Channel] Subscribe timed out')
  } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
    console.log('[Channel] Channel closed')
  }
})

// Wait for subscription
await new Promise((resolve) => setTimeout(resolve, 2000))

// Check channel state
console.log('\n--- Channel State Check ---')
console.log(`Is joined: ${channel.isJoined()}`)
console.log(`Is joining: ${channel.isJoining()}`)
console.log(`Current state: ${channel.getState()}`)

// Test 2: Unsubscribe from channel
console.log('\n--- Test 2: Unsubscribe from channel ---')
const result = await channel.unsubscribe()
console.log(`Unsubscribe result: ${result}`)
console.log(`Is closed: ${channel.isClosed()}`)

// Test 3: Create and subscribe to another channel
console.log('\n--- Test 3: Second channel ---')
const channel2 = client.channel('room:another')
channel2.subscribe((status) => {
  console.log(`[Channel2] Status: ${status}`)
})

await new Promise((resolve) => setTimeout(resolve, 2000))

// List all channels
console.log('\n--- Active Channels ---')
const channels = client.getChannels()
console.log(`Total channels: ${channels.length}`)
channels.forEach((ch, i) => {
  console.log(`  ${i + 1}. ${ch.topic} (state: ${ch.getState()})`)
})

// Clean up
console.log('\n--- Cleanup ---')
await client.removeAllChannels()
console.log('All channels removed')
console.log(`Remaining channels: ${client.getChannels().length}`)

// Disconnect
client.disconnect()
console.log('Disconnected')

console.log('\n=== Test Complete ===')

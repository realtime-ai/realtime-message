/**
 * Test script to verify basic connection and heartbeat functionality
 *
 * Usage:
 * 1. Start the server: npm run dev:server
 * 2. Run this test: node examples/test-connection.mjs
 */

import WebSocket from 'ws'

// For Node.js, we need to provide WebSocket implementation
globalThis.WebSocket = WebSocket

// Direct import from dist
import { RealtimeClient } from '../packages/sdk/dist/index.js'

const client = new RealtimeClient('ws://localhost:4000', {
  logLevel: 'debug',
  heartbeatIntervalMs: 5000, // 5 seconds for testing
})

// Track heartbeat status
client.onHeartbeat((status) => {
  console.log(`[Heartbeat] Status: ${status}`)
})

client.onOpen(() => {
  console.log('[Client] Connected!')
})

client.onClose((event) => {
  console.log(`[Client] Disconnected. Code: ${event.code}, Reason: ${event.reason}`)
})

client.onError((error) => {
  console.error('[Client] Error:', error)
})

// Connect
console.log('[Client] Connecting...')
client.connect()

// Check connection state periodically
const checkInterval = setInterval(() => {
  console.log(`[Client] Connection state: ${client.connectionState()}`)
}, 3000)

// Disconnect after 20 seconds
setTimeout(() => {
  console.log('[Client] Disconnecting...')
  clearInterval(checkInterval)
  client.disconnect()
  console.log('[Client] Test completed!')
  process.exit(0)
}, 20000)

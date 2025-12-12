/**
 * Test script for Iteration 6: JWT Authentication
 *
 * This test requires the server running with AUTH_ENABLED=true:
 *    AUTH_ENABLED=true AUTH_SECRET=test-secret npm run dev:server
 *
 * Then run this test: node examples/test-jwt-auth.mjs
 */

import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '../packages/sdk/dist/index.js'
import * as jose from 'jose'

const ROOM_TOPIC = 'room:auth-test'
const AUTH_SECRET = 'test-secret'

console.log('=== Iteration 6: JWT Authentication Test ===\n')
console.log('NOTE: Make sure you have:')
console.log('  1. Server running with: AUTH_ENABLED=true AUTH_SECRET=test-secret npm run dev:server')
console.log('')

// Helper to generate JWT tokens
async function generateToken(payload, expiresIn = '1h') {
  const secret = new TextEncoder().encode(AUTH_SECRET)
  const jwt = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)

  return jwt.sign(secret)
}

// Test results
const testResults = []

// --- Test 1: No token (should fail) ---
console.log('--- Test 1: Subscribe without token (should fail) ---')
{
  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  if (!client.isConnected()) {
    console.error('Failed to connect')
    process.exit(1)
  }

  const channel = client.channel(ROOM_TOPIC)

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.log(`  Error (expected): ${err?.message}`)
        resolve({ passed: true, reason: 'Correctly rejected without token' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: false, reason: 'Should have been rejected without token' })
      }
    })

    // Timeout
    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Subscribe without token rejected', ...result })

  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 2: Invalid token (should fail) ---
console.log('\n--- Test 2: Subscribe with invalid token (should fail) ---')
{
  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    token: 'invalid-token-here',
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const channel = client.channel(ROOM_TOPIC)

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.log(`  Error (expected): ${err?.message}`)
        resolve({ passed: true, reason: 'Correctly rejected invalid token' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: false, reason: 'Should have been rejected with invalid token' })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Subscribe with invalid token rejected', ...result })

  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 3: Expired token (should fail) ---
console.log('\n--- Test 3: Subscribe with expired token (should fail) ---')
{
  // Generate an expired token
  const expiredToken = await generateToken({ sub: 'user-123' }, '0s')
  await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait for expiration

  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    token: expiredToken,
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const channel = client.channel(ROOM_TOPIC)

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.log(`  Error (expected): ${err?.message}`)
        resolve({ passed: true, reason: 'Correctly rejected expired token' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: false, reason: 'Should have been rejected with expired token' })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Subscribe with expired token rejected', ...result })

  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 4: Valid token (should succeed) ---
console.log('\n--- Test 4: Subscribe with valid token (should succeed) ---')
{
  const validToken = await generateToken({ sub: 'user-123', role: 'user' }, '1h')

  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    token: validToken,
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const channel = client.channel(ROOM_TOPIC)

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: true, reason: 'Correctly subscribed with valid token' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        resolve({ passed: false, reason: `Failed: ${err?.message}` })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Subscribe with valid token succeeds', ...result })

  await client.removeAllChannels()
  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 5: Token with channel restriction (should fail on wrong channel) ---
console.log('\n--- Test 5: Token with channel restriction (wrong channel) ---')
{
  // Token only allows access to 'room:allowed*'
  const restrictedToken = await generateToken({
    sub: 'user-456',
    channels: ['room:allowed*'],
  }, '1h')

  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    token: restrictedToken,
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  // Try to join a channel NOT in the allowed list
  const channel = client.channel('room:not-allowed')

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.log(`  Error (expected): ${err?.message}`)
        resolve({ passed: true, reason: 'Correctly denied access to restricted channel' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: false, reason: 'Should have been denied access' })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Channel restriction enforced', ...result })

  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 6: Token with channel restriction (allowed channel) ---
console.log('\n--- Test 6: Token with channel restriction (allowed channel) ---')
{
  const restrictedToken = await generateToken({
    sub: 'user-789',
    channels: ['room:allowed*'],
  }, '1h')

  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    token: restrictedToken,
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  // Try to join a channel that IS in the allowed list
  const channel = client.channel('room:allowed-test')

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: true, reason: 'Correctly allowed access to matching channel' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        resolve({ passed: false, reason: `Failed: ${err?.message}` })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'Channel wildcard match works', ...result })

  await client.removeAllChannels()
  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 7: setAuth() method ---
console.log('\n--- Test 7: Using setAuth() method ---')
{
  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
  })

  // Set auth after client creation
  const token = await generateToken({ sub: 'user-setauth' }, '1h')
  client.setAuth(token)

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const channel = client.channel('room:setauth-test')

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: true, reason: 'setAuth() works correctly' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        resolve({ passed: false, reason: `Failed: ${err?.message}` })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'setAuth() method works', ...result })

  await client.removeAllChannels()
  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

// --- Test 8: accessToken callback ---
console.log('\n--- Test 8: Using accessToken callback ---')
{
  const client = new RealtimeClient('ws://localhost:4000', {
    heartbeatIntervalMs: 60000,
    logLevel: 'warn',
    accessToken: async () => {
      console.log('  accessToken callback invoked')
      return generateToken({ sub: 'user-callback' }, '1h')
    },
  })

  client.connect()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const channel = client.channel('room:callback-test')

  const result = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      console.log(`  Subscribe status: ${status}`)
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        resolve({ passed: true, reason: 'accessToken callback works correctly' })
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        resolve({ passed: false, reason: `Failed: ${err?.message}` })
      }
    })

    setTimeout(() => resolve({ passed: false, reason: 'Timeout' }), 5000)
  })

  testResults.push({ test: 'accessToken callback works', ...result })

  await client.removeAllChannels()
  client.disconnect()
}

// --- Summary ---
console.log('\n=== Test Summary ===')
testResults.forEach((t) => {
  console.log(`${t.passed ? '\u2713' : '\u2717'} ${t.test}`)
  if (!t.passed) {
    console.log(`    Reason: ${t.reason}`)
  }
})

const passed = testResults.filter((t) => t.passed).length
const total = testResults.length

console.log(`\nResult: ${passed}/${total} tests passed`)

process.exit(passed === total ? 0 : 1)

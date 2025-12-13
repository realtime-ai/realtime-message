import { Redis } from '@upstash/redis'

export interface RedisAdapterOptions {
  url: string
  token?: string
  keyPrefix?: string
}

/**
 * RedisAdapter - Manages Redis connections using @upstash/redis (HTTP-based)
 *
 * Uses Redis Streams instead of Pub/Sub for message delivery:
 * - XADD: Publish messages to a stream
 * - XREAD: Poll for new messages (with BLOCK simulation via polling)
 *
 * Benefits over Pub/Sub:
 * - Works with HTTP-only clients (no TCP required)
 * - Messages are persisted (can be replayed)
 * - Supports consumer groups for scaling
 */
export class RedisAdapter {
  private client: Redis
  private keyPrefix: string
  private subscriptions: Map<string, Set<(message: string) => void>> = new Map()
  private lastIds: Map<string, string> = new Map()
  private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map()
  private readonly POLLING_INTERVAL_MS = 100
  private readonly STREAM_MAX_LEN = 1000 // Trim stream to prevent unbounded growth
  private readonly STREAM_TTL_SECONDS = 3600 // Stream key expires after 1 hour of inactivity

  constructor(options: RedisAdapterOptions) {
    this.keyPrefix = options.keyPrefix ?? 'realtime:'

    if (options.token) {
      this.client = new Redis({
        url: options.url,
        token: options.token,
      })
    } else {
      this.client = Redis.fromEnv()
    }

    console.log(`[RedisAdapter] Connected to Upstash Redis (using Streams)`)
  }

  /**
   * Get stream key for a channel
   */
  private streamKey(channel: string): string {
    return this.keyPrefix + 'stream:' + channel
  }

  /**
   * Publish a message to a stream (replaces pub/sub publish)
   *
   * Uses pipeline to batch XADD and EXPIRE commands in a single request.
   * The stream key TTL is refreshed on each publish to prevent inactive streams from persisting.
   *
   * @param channel - The channel name to publish to
   * @param message - The message payload to publish
   * @returns 1 on success
   */
  async publish(channel: string, message: string): Promise<number> {
    const key = this.streamKey(channel)

    // Use pipeline to batch XADD + EXPIRE in a single HTTP request
    const pipeline = this.client.pipeline()

    // XADD with MAXLEN to auto-trim the stream
    pipeline.xadd(key, '*', { message }, {
      trim: {
        type: 'MAXLEN',
        threshold: this.STREAM_MAX_LEN,
        comparison: '~',
      },
    })

    // Refresh TTL on each publish (stream expires after 1 hour of inactivity)
    pipeline.expire(key, this.STREAM_TTL_SECONDS)

    await pipeline.exec()
    return 1
  }

  /**
   * Subscribe to a stream (replaces pub/sub subscribe)
   * Uses polling to read new messages
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const key = this.streamKey(channel)

    // Add callback to subscriptions
    let callbacks = this.subscriptions.get(key)
    if (!callbacks) {
      callbacks = new Set()
      this.subscriptions.set(key, callbacks)
      // Start reading from the latest message ($ means only new messages)
      this.lastIds.set(key, '$')

      // Start polling for this stream
      const interval = setInterval(async () => {
        await this.pollStream(key)
      }, this.POLLING_INTERVAL_MS)

      this.pollingIntervals.set(key, interval)
    }
    callbacks.add(callback)
  }

  /**
   * Poll a stream for new messages
   */
  private async pollStream(key: string): Promise<void> {
    try {
      const lastId = this.lastIds.get(key) ?? '$'

      // XREAD to get new messages
      // API: xread(key, id, options?) or xread([keys], [ids], options?)
      const result = await this.client.xread(
        key,
        lastId,
        { count: 100 }
      ) as Array<{ name: string; messages: Array<{ id: string; message?: string }> }> | null

      if (result && result.length > 0) {
        const streamData = result[0]
        if (streamData && streamData.messages && streamData.messages.length > 0) {
          const callbacks = this.subscriptions.get(key)

          for (const entry of streamData.messages) {
            // Update last ID
            this.lastIds.set(key, entry.id)

            // Deliver message to callbacks
            if (callbacks && entry.message) {
              for (const cb of callbacks) {
                try {
                  cb(entry.message)
                } catch (error) {
                  console.error('[RedisAdapter] Error in subscription callback:', error)
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[RedisAdapter] Polling error:', error)
    }
  }

  /**
   * Unsubscribe from a stream
   */
  async unsubscribe(channel: string, callback?: (message: string) => void): Promise<void> {
    const key = this.streamKey(channel)
    const callbacks = this.subscriptions.get(key)

    if (callbacks) {
      if (callback) {
        callbacks.delete(callback)
      }
      if (!callback || callbacks.size === 0) {
        this.subscriptions.delete(key)
        this.lastIds.delete(key)
        // Stop polling
        const interval = this.pollingIntervals.get(key)
        if (interval) {
          clearInterval(interval)
          this.pollingIntervals.delete(key)
        }
      }
    }
  }

  /**
   * Get a key with prefix
   */
  private key(k: string): string {
    return this.keyPrefix + k
  }

  /**
   * Set a value
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(this.key(key), ttlSeconds, value)
    } else {
      await this.client.set(this.key(key), value)
    }
  }

  /**
   * Get a value
   */
  async get(key: string): Promise<string | null> {
    return this.client.get<string>(this.key(key))
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<number> {
    return this.client.del(this.key(key))
  }

  /**
   * Add to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0
    return this.client.sadd(this.key(key), members as [string, ...string[]])
  }

  /**
   * Remove from a set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0
    return this.client.srem(this.key(key), members as [string, ...string[]])
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(this.key(key))
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(this.key(key), { [field]: value })
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget<string>(this.key(key), field)
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const result = await this.client.hgetall<Record<string, string>>(this.key(key))
    return result ?? {}
  }

  /**
   * Delete hash field
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(this.key(key), ...fields)
  }

  /**
   * Close all connections and stop polling
   */
  async close(): Promise<void> {
    // Stop all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval)
    }
    this.pollingIntervals.clear()
    this.subscriptions.clear()
    this.lastIds.clear()
    console.log('[RedisAdapter] Connections closed')
  }
}

import { Redis } from '@upstash/redis/cloudflare'

export interface RedisAdapterOptions {
  url: string
  token: string
  keyPrefix?: string
}

/**
 * RedisAdapter for Cloudflare Workers
 *
 * Uses @upstash/redis with Cloudflare Workers runtime.
 * Note: Unlike the Node.js version, this doesn't use polling.
 * Cross-DO messaging is handled via Durable Object alarms or direct calls.
 */
export class RedisAdapter {
  private client: Redis
  private keyPrefix: string
  private readonly STREAM_MAX_LEN = 1000 // Trim stream to prevent unbounded growth
  private readonly STREAM_TTL_SECONDS = 3600 // Stream key expires after 1 hour of inactivity

  constructor(options: RedisAdapterOptions) {
    this.keyPrefix = options.keyPrefix ?? 'realtime:'
    this.client = new Redis({
      url: options.url,
      token: options.token,
    })
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
   * Publish a message to a channel (for cross-region sync if needed)
   *
   * Uses pipeline to batch XADD and EXPIRE commands in a single request.
   * The stream key TTL is refreshed on each publish to prevent inactive streams from persisting.
   *
   * @param channel - The channel name to publish to
   * @param message - The message payload to publish
   */
  async publish(channel: string, message: string): Promise<void> {
    const streamKey = this.key(`stream:${channel}`)

    // Use pipeline to batch XADD + EXPIRE in a single HTTP request
    const pipeline = this.client.pipeline()

    // XADD with MAXLEN to auto-trim the stream
    pipeline.xadd(streamKey, '*', { message }, {
      trim: {
        type: 'MAXLEN',
        threshold: this.STREAM_MAX_LEN,
        comparison: '~',
      },
    })

    // Refresh TTL on each publish (stream expires after 1 hour of inactivity)
    pipeline.expire(streamKey, this.STREAM_TTL_SECONDS)

    await pipeline.exec()
  }

  /**
   * Read messages from a stream (for initial sync)
   */
  async readStream(channel: string, lastId: string = '$', count: number = 100): Promise<Array<{ id: string; message: string }>> {
    const streamKey = this.key(`stream:${channel}`)
    const result = await this.client.xread(
      streamKey,
      lastId,
      { count }
    ) as Array<{ name: string; messages: Array<{ id: string; message?: string }> }> | null

    if (!result || result.length === 0) {
      return []
    }

    const streamData = result[0]
    if (!streamData || !streamData.messages) {
      return []
    }

    return streamData.messages
      .filter((entry): entry is { id: string; message: string } => !!entry.message)
      .map((entry) => ({
        id: entry.id,
        message: entry.message,
      }))
  }
}

/**
 * Create a Redis adapter from environment variables
 */
export function createRedisAdapter(env: { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string }): RedisAdapter | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }

  return new RedisAdapter({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })
}

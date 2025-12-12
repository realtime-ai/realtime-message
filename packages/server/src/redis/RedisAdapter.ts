import { Redis } from 'ioredis'

export interface RedisAdapterOptions {
  host?: string
  port?: number
  password?: string
  db?: number
  keyPrefix?: string
}

/**
 * RedisAdapter - Manages Redis connections for pub/sub and data storage
 */
export class RedisAdapter {
  private pub: Redis
  private sub: Redis
  private client: Redis
  private keyPrefix: string
  private subscriptions: Map<string, Set<(message: string) => void>> = new Map()

  constructor(options: RedisAdapterOptions = {}) {
    const host = options.host ?? 'localhost'
    const port = options.port ?? 6379
    const password = options.password
    const db = options.db ?? 0
    this.keyPrefix = options.keyPrefix ?? 'realtime:'

    const redisOptions = { host, port, password, db }

    // Create three separate connections
    // - pub: for publishing messages
    // - sub: for subscribing (dedicated connection as per Redis requirement)
    // - client: for regular commands (GET, SET, etc.)
    this.pub = new Redis(redisOptions)
    this.sub = new Redis(redisOptions)
    this.client = new Redis(redisOptions)

    // Setup subscription handler
    this.sub.on('message', (channel: string, message: string) => {
      const callbacks = this.subscriptions.get(channel)
      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(message)
          } catch (error) {
            console.error('[RedisAdapter] Error in subscription callback:', error)
          }
        }
      }
    })

    console.log(`[RedisAdapter] Connected to Redis at ${host}:${port}`)
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    const fullChannel = this.keyPrefix + channel
    return this.pub.publish(fullChannel, message)
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const fullChannel = this.keyPrefix + channel

    // Add callback to subscriptions
    let callbacks = this.subscriptions.get(fullChannel)
    if (!callbacks) {
      callbacks = new Set()
      this.subscriptions.set(fullChannel, callbacks)
      await this.sub.subscribe(fullChannel)
    }
    callbacks.add(callback)
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string, callback?: (message: string) => void): Promise<void> {
    const fullChannel = this.keyPrefix + channel
    const callbacks = this.subscriptions.get(fullChannel)

    if (callbacks) {
      if (callback) {
        callbacks.delete(callback)
      }
      if (!callback || callbacks.size === 0) {
        this.subscriptions.delete(fullChannel)
        await this.sub.unsubscribe(fullChannel)
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
    return this.client.get(this.key(key))
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
    return this.client.sadd(this.key(key), ...members)
  }

  /**
   * Remove from a set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(this.key(key), ...members)
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
    return this.client.hset(this.key(key), field, value)
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(this.key(key), field)
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(this.key(key))
  }

  /**
   * Delete hash field
   */
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(this.key(key), ...fields)
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.pub.quit()
    await this.sub.quit()
    await this.client.quit()
    console.log('[RedisAdapter] Connections closed')
  }
}

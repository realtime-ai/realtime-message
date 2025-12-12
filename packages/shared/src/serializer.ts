import type { RawMessage, Message } from './types.js'

/**
 * Serialize Message to raw array format for WebSocket transmission
 */
export function encode(message: Message): string {
  const raw: RawMessage = [
    message.join_seq,
    message.seq,
    message.topic,
    message.event,
    message.payload,
  ]
  return JSON.stringify(raw)
}

/**
 * Parse raw WebSocket data to Message object
 */
export function decode(data: string): Message | null {
  try {
    const raw = JSON.parse(data) as unknown
    if (!Array.isArray(raw) || raw.length !== 5) {
      return null
    }
    const [join_seq, seq, topic, event, payload] = raw as RawMessage
    return {
      join_seq,
      seq,
      topic,
      event,
      payload,
    }
  } catch {
    return null
  }
}

/**
 * Create a reply message
 */
export function createReply(
  seq: string | null,
  topic: string,
  status: 'ok' | 'error',
  response: Record<string, unknown> = {}
): Message {
  return {
    join_seq: null,
    seq,
    topic,
    event: 'chan:reply',
    payload: { status, response },
  }
}

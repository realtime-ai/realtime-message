import {
  CHANNEL_EVENTS,
  DEFAULT_TIMEOUT,
  type Message,
  type ReplyPayload,
} from '@realtime-message/shared'
import type { RealtimeChannel } from '../RealtimeChannel.js'

type ReceiveStatus = 'ok' | 'error' | 'timeout'
type ReceiveCallback = (response: Record<string, unknown>) => void

interface ReceiveHook {
  status: ReceiveStatus
  callback: ReceiveCallback
}

/**
 * Push - Handles sending messages and matching responses via seq
 */
export class Push {
  private seq: string = ''
  private seqEvent: string = ''
  private receiveHooks: ReceiveHook[] = []
  private sent: boolean = false
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private receivedResp: ReplyPayload | null = null

  constructor(
    private channel: RealtimeChannel,
    private event: string,
    private payload: unknown,
    private timeout: number = DEFAULT_TIMEOUT
  ) {}

  /**
   * Send the message
   */
  send(): void {
    if (this.sent) {
      return
    }
    this.sent = true
    this.startTimeout()

    const message: Message = {
      join_seq: this.channel.joinSeq,
      seq: this.seq,
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload,
    }

    this.channel.socket.push(message)
  }

  /**
   * Resend the message (for rejoin)
   */
  resend(timeout?: number): void {
    this.timeout = timeout ?? this.timeout
    this.reset()
    this.send()
  }

  /**
   * Register a callback for a specific status
   */
  receive(status: ReceiveStatus, callback: ReceiveCallback): this {
    // If already received, trigger immediately
    if (this.receivedResp && this.receivedResp.status === status) {
      callback(this.receivedResp.response)
    } else {
      this.receiveHooks.push({ status, callback })
    }
    return this
  }

  /**
   * Get the seq for this push
   */
  getSeq(): string {
    return this.seq
  }

  /**
   * Get the seq event name for reply matching
   */
  getSeqEvent(): string {
    return this.seqEvent
  }

  /**
   * Handle reply from server
   */
  handleReply(payload: ReplyPayload): void {
    this.cancelTimeout()
    this.receivedResp = payload
    this.matchReceive(payload)
  }

  /**
   * Cancel and reset the push
   */
  reset(): void {
    this.cancelTimeout()
    this.sent = false
    this.receivedResp = null
  }

  // Private methods

  private startTimeout(): void {
    this.seq = this.channel.socket.makeSeq()
    this.seqEvent = `chan_reply_${this.seq}`

    // Register for reply
    this.channel.onReply(this.seqEvent, (payload) => {
      this.handleReply(payload)
    })

    // Set timeout
    this.timeoutTimer = setTimeout(() => {
      this.trigger('timeout', {})
    }, this.timeout)
  }

  private cancelTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }

  private matchReceive(payload: ReplyPayload): void {
    this.trigger(payload.status, payload.response)
  }

  private trigger(status: ReceiveStatus, response: Record<string, unknown>): void {
    for (const hook of this.receiveHooks) {
      if (hook.status === status) {
        hook.callback(response)
      }
    }
  }
}

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  RealtimeClient,
  RealtimeChannel,
  REALTIME_SUBSCRIBE_STATES,
} from '@realtime-message/sdk'
import type { Presence, RealtimePresenceJoinPayload, RealtimePresenceLeavePayload } from '@realtime-message/sdk'

interface Message {
  id: string
  user: string
  text: string
  timestamp: number
  color: string
}

interface PresenceUser {
  user: string
  color: string
  joinedAt: number
}

const COLORS = [
  '#00f0ff', '#a855f7', '#ff0080', '#00ff88', '#ffee00',
  '#ff3366', '#00a8b3', '#e879f9', '#22d3ee', '#4ade80',
]

function getRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

export default function App() {
  const [serverUrl, setServerUrl] = useState('ws://localhost:4000')
  const [connectionState, setConnectionState] = useState<string>('disconnected')
  const [username, setUsername] = useState('')
  const [roomName, setRoomName] = useState('general')
  const [isJoined, setIsJoined] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([])
  const [userColor] = useState(getRandomColor)
  const [userId] = useState(() => generateId())
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())

  const clientRef = useRef<RealtimeClient | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const myPresenceRef = useRef<PresenceUser | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      if (channelRef.current) {
        channelRef.current.unsubscribe()
      }
      if (clientRef.current) {
        clientRef.current.disconnect()
      }
    }
  }, [])

  const connect = useCallback(() => {
    if (clientRef.current) return

    const client = new RealtimeClient(serverUrl, {
      heartbeatIntervalMs: 30000,
      logLevel: 'info',
    })

    client.onOpen(() => setConnectionState('connected'))
    client.onClose(() => {
      setConnectionState('disconnected')
      setIsJoined(false)
      setOnlineUsers([])
    })
    client.onError(() => setConnectionState('error'))
    client.onHeartbeat((status) => {
      if (status === 'ok') {
        setConnectionState('connected')
      }
    })

    client.connect()
    clientRef.current = client
    setConnectionState('connecting')
  }, [serverUrl])

  const disconnect = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
    if (clientRef.current) {
      clientRef.current.disconnect()
      clientRef.current = null
    }
    setConnectionState('disconnected')
    setIsJoined(false)
    setOnlineUsers([])
    setMessages([])
  }, [])

  const joinRoom = useCallback(async () => {
    if (!clientRef.current || !username.trim() || !roomName.trim()) return

    const channel = clientRef.current.channel(`room:${roomName}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    })

    // Listen for chat messages
    channel.on('broadcast', { event: 'message' }, (payload) => {
      const msg = payload.payload as Message
      setMessages((prev) => [...prev, msg])
    })

    // Listen for typing indicators
    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const { user, isTyping } = payload.payload as { user: string; isTyping: boolean }
      setTypingUsers((prev) => {
        const next = new Set(prev)
        if (isTyping) {
          next.add(user)
        } else {
          next.delete(user)
        }
        return next
      })
    })

    // Setup presence
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceUser>()
      const users: PresenceUser[] = []
      Object.entries(state).forEach(([, presences]) => {
        presences.forEach((p: Presence<PresenceUser>) => {
          if (p.meta?.user) {
            users.push(p.meta)
          }
        })
      })
      // Always include current user if they've tracked
      const myPresence = myPresenceRef.current
      if (myPresence && !users.some((u) => u.user === myPresence.user)) {
        users.push(myPresence)
      }
      setOnlineUsers(users)
    })

    channel.on('presence', { event: 'join' }, (payload: RealtimePresenceJoinPayload<PresenceUser>) => {
      payload.newPresences.forEach((p: Presence<PresenceUser>) => {
        const meta = p.meta
        if (meta?.user) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              user: 'System',
              text: `${meta.user} joined the room`,
              timestamp: Date.now(),
              color: '#00f0ff',
            },
          ])
        }
      })
    })

    channel.on('presence', { event: 'leave' }, (payload: RealtimePresenceLeavePayload<PresenceUser>) => {
      const leftUsernames: string[] = []
      payload.leftPresences.forEach((p: Presence<PresenceUser>) => {
        const meta = p.meta
        if (meta?.user) {
          leftUsernames.push(meta.user)
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              user: 'System',
              text: `${meta.user} left the room`,
              timestamp: Date.now(),
              color: '#ff3366',
            },
          ])
        }
      })
      // Remove left users from online list
      if (leftUsernames.length > 0) {
        setOnlineUsers((prev) => prev.filter((u) => !leftUsernames.includes(u.user)))
      }
    })

    // Prepare our presence before subscribing so sync callback can use it
    const myPresence = {
      user: username,
      color: userColor,
      joinedAt: Date.now(),
    }
    myPresenceRef.current = myPresence

    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        setIsJoined(true)
        channel.track(myPresence)
        // Add self to online users immediately
        setOnlineUsers((prev) => {
          if (prev.some((u) => u.user === username)) return prev
          return [...prev, myPresence]
        })
      }
    })

    channelRef.current = channel
  }, [username, roomName, userColor, userId])

  const leaveRoom = useCallback(async () => {
    if (channelRef.current) {
      await channelRef.current.unsubscribe()
      channelRef.current = null
    }
    myPresenceRef.current = null
    setIsJoined(false)
    setOnlineUsers([])
    setMessages([])
    setTypingUsers(new Set())
  }, [])

  const sendMessage = useCallback(async () => {
    if (!channelRef.current || !inputMessage.trim()) return

    const msg: Message = {
      id: generateId(),
      user: username,
      text: inputMessage.trim(),
      timestamp: Date.now(),
      color: userColor,
    }

    // Add message locally
    setMessages((prev) => [...prev, msg])

    // Broadcast to others
    await channelRef.current.send({
      type: 'broadcast',
      event: 'message',
      payload: msg,
    })

    // Clear typing indicator
    await channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user: username, isTyping: false },
    })

    setInputMessage('')
  }, [inputMessage, username, userColor])

  const handleTyping = useCallback(() => {
    if (!channelRef.current) return

    // Send typing indicator
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user: username, isTyping: true },
    })

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set timeout to clear typing indicator
    typingTimeoutRef.current = window.setTimeout(() => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user: username, isTyping: false },
      })
    }, 2000)
  }, [username])

  const getStatusClass = () => {
    switch (connectionState) {
      case 'connected':
        return 'status-connected'
      case 'connecting':
        return 'status-connecting'
      case 'error':
        return 'status-error'
      default:
        return 'status-disconnected'
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen relative">
      {/* Background effects */}
      <div className="cyber-grid" />
      <div className="noise-overlay" />
      <div className="scanlines" />

      {/* Main content */}
      <div className="relative z-10 container mx-auto max-w-7xl p-4 h-screen flex flex-col">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="cyber-header text-3xl font-bold tracking-wider">
              REALTIME NEXUS
            </h1>
            <p className="text-[var(--cyber-text-dim)] text-sm mt-1 tracking-wide">
              <span className="text-[var(--cyber-cyan)]">&gt;</span> @realtime-message/sdk <span className="text-[var(--cyber-purple)]">v1.0</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-[var(--cyber-text-dim)]">
              <div>STATUS</div>
              <div className="text-[var(--cyber-cyan)] uppercase">{connectionState}</div>
            </div>
            <div className={`w-3 h-3 rounded-full status-dot ${getStatusClass()}`} />
          </div>
        </header>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Left Panel - Settings & Users */}
          <aside className="w-80 flex flex-col gap-4">
            {/* Connection Panel */}
            <div className="cyber-panel cyber-glow rounded-lg p-5">
              <h2 className="section-header">Connection</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[var(--cyber-text-dim)] mb-2 uppercase tracking-wider">
                    Server Endpoint
                  </label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    disabled={connectionState !== 'disconnected'}
                    className="cyber-input w-full px-3 py-2.5 rounded text-sm"
                    placeholder="ws://localhost:4000"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--cyber-text-dim)] mb-2 uppercase tracking-wider">
                    User ID
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isJoined}
                    className="cyber-input w-full px-3 py-2.5 rounded text-sm"
                    placeholder="Enter callsign..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--cyber-text-dim)] mb-2 uppercase tracking-wider">
                    Channel
                  </label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    disabled={isJoined}
                    className="cyber-input w-full px-3 py-2.5 rounded text-sm"
                    placeholder="general"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  {connectionState === 'disconnected' ? (
                    <button
                      onClick={connect}
                      className="cyber-btn cyber-btn-primary flex-1 py-2.5 px-4 rounded text-sm"
                    >
                      Initialize
                    </button>
                  ) : (
                    <button
                      onClick={disconnect}
                      className="cyber-btn cyber-btn-danger flex-1 py-2.5 px-4 rounded text-sm"
                    >
                      Terminate
                    </button>
                  )}

                  {connectionState === 'connected' && !isJoined && (
                    <button
                      onClick={joinRoom}
                      disabled={!username.trim()}
                      className="cyber-btn cyber-btn-success flex-1 py-2.5 px-4 rounded text-sm"
                    >
                      Join
                    </button>
                  )}

                  {isJoined && (
                    <button
                      onClick={leaveRoom}
                      className="cyber-btn cyber-btn-warning flex-1 py-2.5 px-4 rounded text-sm"
                    >
                      Exit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Online Users Panel */}
            <div className="flex-1 cyber-panel cyber-glow rounded-lg p-5 overflow-hidden flex flex-col">
              <h2 className="section-header">
                Active Users
                <span className="ml-auto text-[var(--cyber-green)]">[{onlineUsers.length}]</span>
              </h2>

              <div className="flex-1 overflow-y-auto space-y-2">
                {onlineUsers.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-[var(--cyber-text-dim)] text-xs uppercase tracking-wider">
                      {isJoined ? '// No other users detected' : '// Join channel to scan users'}
                    </div>
                  </div>
                ) : (
                  onlineUsers.map((user, idx) => (
                    <div
                      key={`${user.user}-${idx}`}
                      className="user-card flex items-center gap-3 p-3"
                    >
                      <div
                        className="cyber-avatar w-9 h-9 text-xs text-[var(--cyber-bg)]"
                        style={{ backgroundColor: user.color }}
                      >
                        {user.user.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm" style={{ color: user.color }}>
                          {user.user}
                          {user.user === username && (
                            <span className="text-[var(--cyber-text-dim)] ml-1 text-xs">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-[var(--cyber-text-dim)]">
                          Online since {formatTime(user.joinedAt)}
                        </p>
                      </div>
                      <div className="w-2 h-2 rounded-full status-connected status-dot" />
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Chat Area */}
          <main className="flex-1 flex flex-col cyber-panel cyber-glow-purple rounded-lg overflow-hidden">
            {/* Room Header */}
            <div className="p-4 border-b border-[var(--cyber-border)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="room-badge">#{roomName}</span>
                <span className="text-xs text-[var(--cyber-text-dim)]">
                  {isJoined ? 'CONNECTED' : 'OFFLINE'}
                </span>
              </div>
              {typingUsers.size > 0 && (
                <div className="flex items-center gap-2 text-sm text-[var(--cyber-cyan)]">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span className="text-xs">
                    {Array.from(typingUsers).join(', ')} typing...
                  </span>
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-4 opacity-10">⬡</div>
                    <p className="text-[var(--cyber-text-dim)] text-sm uppercase tracking-wider">
                      {isJoined ? '// Awaiting transmission...' : '// Join channel to begin'}
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-enter ${msg.user === 'System' ? 'flex justify-center' : 'flex gap-3'}`}
                  >
                    {msg.user === 'System' ? (
                      <p className="system-message">
                        {msg.text}
                      </p>
                    ) : (
                      <>
                        <div
                          className="cyber-avatar w-9 h-9 flex-shrink-0 text-xs text-[var(--cyber-bg)]"
                          style={{ backgroundColor: msg.color }}
                        >
                          {msg.user.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="font-semibold text-sm" style={{ color: msg.color }}>
                              {msg.user}
                            </span>
                            <span className="text-xs text-[var(--cyber-text-dim)]">
                              {formatTime(msg.timestamp)}
                            </span>
                          </div>
                          <div className="message-bubble">
                            <p className="text-[var(--cyber-text)] break-words text-sm">{msg.text}</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-[var(--cyber-border)]">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  sendMessage()
                }}
                className="flex gap-3"
              >
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cyber-cyan)] text-sm opacity-50">
                    &gt;
                  </span>
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => {
                      setInputMessage(e.target.value)
                      handleTyping()
                    }}
                    disabled={!isJoined}
                    className="cyber-input w-full pl-8 pr-4 py-3 rounded text-sm"
                    placeholder={isJoined ? 'Enter transmission...' : 'Join channel to transmit'}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!isJoined || !inputMessage.trim()}
                  className="cyber-btn cyber-btn-primary px-6 py-3 rounded text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Send
                </button>
              </form>
            </div>
          </main>
        </div>

        {/* Footer */}
        <footer className="mt-4 tech-footer text-center">
          <p>
            <span>[</span> BROADCAST <span>|</span> PRESENCE <span>|</span> CHANNELS <span>|</span> REALTIME <span>]</span>
          </p>
        </footer>
      </div>
    </div>
  )
}

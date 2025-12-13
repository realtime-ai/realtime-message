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
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#6366f1',
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
              color: '#6b7280',
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
              color: '#6b7280',
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

  const getConnectionColor = () => {
    switch (connectionState) {
      case 'connected':
        return 'bg-green-500'
      case 'connecting':
        return 'bg-yellow-500'
      case 'error':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="container mx-auto max-w-6xl p-4 h-screen flex flex-col">
        {/* Header */}
        <header className="mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Realtime Chat Demo
          </h1>
          <p className="text-slate-400 mt-1">
            Powered by @realtime-message/sdk
          </p>
        </header>

        <div className="flex-1 flex gap-6 min-h-0">
          {/* Left Panel - Settings & Users */}
          <aside className="w-80 flex flex-col gap-4">
            {/* Connection Panel */}
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700/50">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${getConnectionColor()} ${connectionState === 'connecting' ? 'animate-pulse' : ''}`}></span>
                Connection
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Server URL</label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    disabled={connectionState !== 'disconnected'}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 transition-colors"
                    placeholder="ws://localhost:4000"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Your Name</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isJoined}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 transition-colors"
                    placeholder="Enter your name"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Room Name</label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    disabled={isJoined}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 transition-colors"
                    placeholder="general"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  {connectionState === 'disconnected' ? (
                    <button
                      onClick={connect}
                      className="flex-1 py-2 px-4 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium text-sm transition-colors"
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      onClick={disconnect}
                      className="flex-1 py-2 px-4 bg-red-600/80 hover:bg-red-500 rounded-lg font-medium text-sm transition-colors"
                    >
                      Disconnect
                    </button>
                  )}

                  {connectionState === 'connected' && !isJoined && (
                    <button
                      onClick={joinRoom}
                      disabled={!username.trim()}
                      className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-500 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Join Room
                    </button>
                  )}

                  {isJoined && (
                    <button
                      onClick={leaveRoom}
                      className="flex-1 py-2 px-4 bg-orange-600/80 hover:bg-orange-500 rounded-lg font-medium text-sm transition-colors"
                    >
                      Leave Room
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Online Users Panel */}
            <div className="flex-1 bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700/50 overflow-hidden flex flex-col">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Online ({onlineUsers.length})
              </h2>

              <div className="flex-1 overflow-y-auto space-y-2">
                {onlineUsers.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">
                    {isJoined ? 'No other users online' : 'Join a room to see online users'}
                  </p>
                ) : (
                  onlineUsers.map((user, idx) => (
                    <div
                      key={`${user.user}-${idx}`}
                      className="flex items-center gap-3 p-2 rounded-lg bg-slate-700/30"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: user.color }}
                      >
                        {user.user.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">
                          {user.user}
                          {user.user === username && (
                            <span className="text-slate-500 ml-1">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          Joined {formatTime(user.joinedAt)}
                        </p>
                      </div>
                      <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Chat Area */}
          <main className="flex-1 flex flex-col bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700/50 overflow-hidden">
            {/* Room Header */}
            <div className="p-4 border-b border-slate-700/50">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-slate-400">#</span>
                {roomName}
              </h2>
              {typingUsers.size > 0 && (
                <p className="text-sm text-slate-400 mt-1 animate-pulse">
                  {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
                </p>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-slate-500">
                      {isJoined ? 'No messages yet. Start the conversation!' : 'Join a room to start chatting'}
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.user === 'System' ? 'justify-center' : ''}`}
                  >
                    {msg.user === 'System' ? (
                      <p className="text-sm text-slate-500 italic bg-slate-700/30 px-4 py-1.5 rounded-full">
                        {msg.text}
                      </p>
                    ) : (
                      <>
                        <div
                          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                          style={{ backgroundColor: msg.color }}
                        >
                          {msg.user.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold text-sm" style={{ color: msg.color }}>
                              {msg.user}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatTime(msg.timestamp)}
                            </span>
                          </div>
                          <p className="text-slate-200 break-words mt-0.5">{msg.text}</p>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-slate-700/50">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  sendMessage()
                }}
                className="flex gap-3"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => {
                    setInputMessage(e.target.value)
                    handleTyping()
                  }}
                  disabled={!isJoined}
                  className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl focus:outline-none focus:border-purple-500 disabled:opacity-50 transition-colors"
                  placeholder={isJoined ? 'Type a message...' : 'Join a room to chat'}
                />
                <button
                  type="submit"
                  disabled={!isJoined || !inputMessage.trim()}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </button>
              </form>
            </div>
          </main>
        </div>

        {/* Footer */}
        <footer className="mt-6 text-center text-slate-500 text-sm">
          <p>
            SDK Features: Connection Management | Channels | Broadcast Messaging | Presence Tracking
          </p>
        </footer>
      </div>
    </div>
  )
}

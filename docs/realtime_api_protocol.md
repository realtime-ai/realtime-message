# Realtime API 设计与交互协议

> 本文档详细描述了 Realtime 客户端的公共 API 设计和底层 WebSocket 交互协议。

## 目录

- [一、架构概览](#一架构概览)
- [二、公共 API 设计](#二公共-api-设计)
  - [RealtimeClient](#1-realtimeclient---连接管理器)
  - [RealtimeChannel](#2-realtimechannel---频道订阅)
  - [RealtimePresence](#3-realtimepresence---在线状态)
  - [事件监听 API](#4-事件监听-api-channelon)
- [三、认证机制](#三认证机制)
- [四、WebSocket 协议详解](#四websocket-协议详解)
  - [连接建立](#1-连接建立)
  - [消息格式](#2-消息格式)
  - [协议事件](#3-协议事件)
  - [频道加入流程](#4-频道加入流程)
  - [心跳机制](#5-心跳机制)
- [五、功能协议](#五功能协议)
  - [Broadcast 消息](#1-broadcast-消息)
  - [Presence 协议](#2-presence-协议)
- [六、状态机](#六状态机)
- [七、请求-响应匹配机制](#七请求-响应匹配机制)
- [八、重连与容错](#八重连与容错)
- [九、错误处理](#九错误处理)
- [十、限制与配额](#十限制与配额)
- [十一、常量与枚举](#十一常量与枚举)

---

## 一、架构概览

### 核心模块

```
┌─────────────────────────────────────────────────────────────┐
│                      RealtimeClient                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  WebSocket Connection                │   │
│  │  • 连接管理 (connect/disconnect)                     │   │
│  │  • 心跳检测 (25s interval)                           │   │
│  │  • 自动重连 (指数退避)                               │   │
│  │  • 消息编解码 (JSON)                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│              ┌─────────────┴─────────────┐                 │
│              ▼                           ▼                 │
│  ┌─────────────────────┐    ┌─────────────────────┐       │
│  │  RealtimeChannel    │    │  RealtimeChannel    │       │
│  │  ┌───────────────┐  │    │  ┌───────────────┐  │       │
│  │  │   Broadcast   │  │    │  │   Broadcast   │  │       │
│  │  ├───────────────┤  │    │  ├───────────────┤  │       │
│  │  │   Presence    │  │    │  │   Presence    │  │       │
│  │  └───────────────┘  │    │  └───────────────┘  │       │
│  └─────────────────────┘    └─────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 文件结构

```
src/
├── index.ts              # 公共 API 导出
├── RealtimeClient.ts     # WebSocket 客户端核心
├── RealtimeChannel.ts    # 频道抽象层
├── RealtimePresence.ts   # 在线状态追踪
└── lib/
    ├── constants.ts      # 常量和枚举定义
    ├── push.ts           # 消息推送与 seq 响应匹配
    ├── timer.ts          # 指数退避定时器
    ├── serializer.ts     # JSON 消息编解码
    └── websocket-factory.ts  # WebSocket 工厂 (多环境支持)
```

---

## 二、公共 API 设计

### 1. RealtimeClient - 连接管理器

`RealtimeClient` 是整个 Realtime 系统的入口，负责 WebSocket 连接的生命周期管理。

#### 构造函数

```typescript
import { RealtimeClient } from 'realtime-js'

const client = new RealtimeClient(endPoint: string, options?: RealtimeClientOptions)
```

#### 配置选项

```typescript
interface RealtimeClientOptions {
  // WebSocket 配置
  transport?: WebSocketLikeConstructor  // 自定义 WebSocket 实现 (Node.js < 22 需要)
  timeout?: number                       // 默认超时时间，默认 10000ms
  heartbeatIntervalMs?: number           // 心跳间隔，默认 25000ms
  heartbeatCallback?: (status: HeartbeatStatus) => void  // 心跳状态回调

  // 认证 (JWT Token)
  accessToken?: () => Promise<string | null>  // JWT Token 获取回调 (推荐)
  // 或者
  token?: string                         // 静态 JWT Token (适用于短期使用)

  // 日志
  logger?: Function                      // 自定义日志函数
  logLevel?: 'info' | 'warn' | 'error'   // 日志级别

  // 重连
  reconnectAfterMs?: (tries: number) => number  // 自定义重连间隔计算

  // 高级选项
  fetch?: Fetch                          // 自定义 fetch 实现
  worker?: boolean                       // 使用 Web Worker 发送心跳
  workerUrl?: string                     // Web Worker 脚本 URL
}
```

#### 核心方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `connect` | `() => void` | 建立 WebSocket 连接 |
| `disconnect` | `(code?: number, reason?: string) => void` | 断开连接 |
| `channel` | `(topic: string, params?: RealtimeChannelOptions) => RealtimeChannel` | 创建或获取 Channel |
| `removeChannel` | `(channel: RealtimeChannel) => Promise<RealtimeRemoveChannelResponse>` | 移除单个 Channel |
| `removeAllChannels` | `() => Promise<RealtimeRemoveChannelResponse[]>` | 移除所有 Channel |
| `setAuth` | `(token?: string \| null) => Promise<void>` | 设置或刷新 JWT Token |
| `getChannels` | `() => RealtimeChannel[]` | 获取所有 Channel |
| `isConnected` | `() => boolean` | 检查是否已连接 |
| `isConnecting` | `() => boolean` | 检查是否正在连接 |
| `connectionState` | `() => CONNECTION_STATE` | 获取连接状态 |

#### 使用示例

```typescript
import { RealtimeClient } from 'realtime-js'

// 方式一：使用 accessToken 回调 (推荐 - 支持自动刷新)
const client = new RealtimeClient('wss://your-server.com/realtime/v1', {
  accessToken: async () => {
    // 从你的认证系统获取 JWT Token
    const session = await auth.getSession()
    return session?.access_token ?? null
  },
})

// 方式二：使用静态 Token (适用于短期使用或测试)
const client = new RealtimeClient('wss://your-server.com/realtime/v1', {
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
})

// 心跳监控
client.onHeartbeat((status) => {
  console.log('Heartbeat status:', status) // 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected'
})

// 连接
client.connect()

// 手动刷新 Token (当使用静态 token 时)
await client.setAuth('new-jwt-token')

// 断开
client.disconnect()
```

---

### 2. RealtimeChannel - 频道订阅

`RealtimeChannel` 是订阅实时事件的核心抽象，支持两种功能：Broadcast 和 Presence。

#### 创建 Channel

```typescript
const channel = client.channel(topic: string, params?: RealtimeChannelOptions)
```

#### 配置选项

```typescript
interface RealtimeChannelOptions {
  config: {
    // Broadcast 配置
    broadcast?: {
      self?: boolean      // 是否接收自己发送的广播消息，默认 false
      ack?: boolean       // 是否需要服务端确认，默认 false
    }

    // Presence 配置
    presence?: {
      key?: string        // Presence 标识 key，默认为空字符串
      enabled?: boolean   // 是否启用 Presence，默认 false
    }
  }
}
```

#### 核心方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `subscribe` | `(callback?, timeout?) => RealtimeChannel` | 订阅频道 |
| `unsubscribe` | `(timeout?) => Promise<'ok' \| 'timed out' \| 'error'>` | 取消订阅 |
| `on` | `(type, filter, callback) => RealtimeChannel` | 注册事件监听器 |
| `send` | `(args, opts?) => Promise<RealtimeChannelSendResponse>` | 发送消息 (WebSocket) |
| `httpSend` | `(event, payload, opts?) => Promise<{success: boolean, ...}>` | 发送广播 (REST API) |
| `track` | `(payload, opts?) => Promise<RealtimeChannelSendResponse>` | 追踪 Presence 状态 |
| `untrack` | `(opts?) => Promise<RealtimeChannelSendResponse>` | 停止追踪 Presence |
| `presenceState` | `() => RealtimePresenceState` | 获取当前 Presence 状态 |

#### 订阅状态回调

```typescript
channel.subscribe((status, err) => {
  switch (status) {
    case 'SUBSCRIBED':
      console.log('Successfully subscribed!')
      break
    case 'TIMED_OUT':
      console.log('Subscription timed out')
      break
    case 'CLOSED':
      console.log('Channel closed')
      break
    case 'CHANNEL_ERROR':
      console.error('Channel error:', err)
      break
  }
})
```

---

### 3. RealtimePresence - 在线状态

`RealtimePresence` 用于追踪和同步用户在线状态。

#### Presence 状态结构

```typescript
interface RealtimePresenceState<T = {}> {
  [key: string]: Presence<T>[]  // key 通常是 user_id 或其他标识
}

interface Presence<T = {}> {
  presence_ref: string  // 唯一引用标识 (同一用户多设备时区分)
  // ... 用户自定义字段
} & T
```

#### Join/Leave Payload

```typescript
// 用户加入
interface RealtimePresenceJoinPayload<T> {
  event: 'join'
  key: string                    // 用户标识
  currentPresences: Presence<T>[] // 该用户当前所有 presence
  newPresences: Presence<T>[]     // 新加入的 presence
}

// 用户离开
interface RealtimePresenceLeavePayload<T> {
  event: 'leave'
  key: string
  currentPresences: Presence<T>[] // 该用户剩余的 presence
  leftPresences: Presence<T>[]    // 离开的 presence
}
```

---

### 4. 事件监听 API (channel.on)

`channel.on()` 提供了类型安全的事件监听接口。

#### Broadcast 监听

```typescript
// 基础用法
channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log(payload)
  // {
  //   type: 'broadcast',
  //   event: 'message',
  //   payload: { ... },
  //   meta?: { id: string, replayed?: boolean }
  // }
})

// 带类型的 payload
interface ChatMessage {
  text: string
  userId: string
}

channel.on<ChatMessage>('broadcast', { event: 'chat' }, (payload) => {
  console.log(payload.payload.text) // 类型安全
})
```

#### Presence 监听

```typescript
// 同步完成事件
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState()
  console.log('Current online users:', Object.keys(state))
})

// 用户加入
channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`User ${key} joined with`, newPresences)
})

// 用户离开
channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
  console.log(`User ${key} left`, leftPresences)
})
```

---

## 三、认证机制

本 SDK 使用 JWT (JSON Web Token) 进行用户身份认证。

### 认证流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JWT 认证流程                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 获取 Token                                                       │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │  用户登录 → 认证服务器 → 返回 JWT Token                    │    │
│     └──────────────────────────────────────────────────────────┘    │
│                                                                      │
│  2. WebSocket 连接                                                   │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │  wss://server/realtime/v1/websocket                      │    │
│     └──────────────────────────────────────────────────────────┘    │
│     → 建立 WebSocket 连接 (此时未认证)                               │
│                                                                      │
│  3. 频道加入时认证                                                   │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │  chan:join payload: { access_token: "eyJ...", ... }      │    │
│     └──────────────────────────────────────────────────────────┘    │
│     → 服务端验证 JWT 签名和有效期                                    │
│     → 解析用户身份 (user_id, role 等)                                │
│     → 检查用户是否有权加入该频道                                     │
│                                                                      │
│  4. Token 刷新 (运行时)                                              │
│     ┌──────────────────────────────────────────────────────────┐    │
│     │  access_token 事件: { access_token: "新JWT" }            │    │
│     └──────────────────────────────────────────────────────────┘    │
│     → 当 JWT 即将过期时，客户端发送新 token                          │
│     → 保持连接不中断                                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Token 配置方式

```typescript
// 方式一：动态获取 (推荐 - 支持自动刷新)
const client = new RealtimeClient('wss://server/realtime/v1', {
  accessToken: async () => {
    // 每次需要 token 时调用此函数
    // 可以从 localStorage、auth provider 等获取
    const session = await auth.getSession()
    return session?.access_token ?? null
  },
})

// 方式二：静态 Token
const client = new RealtimeClient('wss://server/realtime/v1', {
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
})
```

### Token 刷新时机

SDK 会在以下时机自动调用 `accessToken` 回调获取新 token：

1. **频道加入时** - 首次加入频道需要 token
2. **心跳时** - 定期检查并刷新 token
3. **重连时** - 连接恢复后重新认证

### 手动刷新 Token

```typescript
// 当使用静态 token 时，需要手动刷新
await client.setAuth('new-jwt-token')

// 清除 token (变为未认证状态)
await client.setAuth(null)
```

### JWT Token 结构 (推荐)

```typescript
// JWT Payload 推荐包含以下字段
interface JWTPayload {
  sub: string          // 用户 ID
  role?: string        // 用户角色
  exp: number          // 过期时间 (Unix timestamp)
  iat: number          // 签发时间 (Unix timestamp)
  // 其他自定义字段...
}
```

---

## 四、WebSocket 协议详解

### 1. 连接建立

#### URL 格式

```
wss://{your-server}/realtime/v1/websocket
```

#### 查询参数

| 参数 | 必须 | 说明 |
|------|------|------|
| `log_level` | 否 | 服务端日志级别：`info` \| `warn` \| `error` |

#### 连接示例

```
wss://your-server.com/realtime/v1/websocket
```

> **认证说明**：JWT Token 通过频道加入时的 `access_token` 字段传递，而非 URL 参数。这样更安全，避免 token 出现在日志中。

---

### 2. 消息格式

所有消息使用 JSON 数组格式：

```typescript
// 格式
[join_seq, seq, topic, event, payload]

// 字段说明
// join_seq: 频道加入时的 seq，用于关联响应
// seq:      消息唯一标识（递增序列号），用于匹配请求-响应
// topic:    频道主题，如 "realtime:room1"
// event:    事件名称，如 "chan:join", "broadcast"
// payload:  消息内容
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| join_seq | `string \| null` | 频道加入时的 seq，用于关联响应 |
| seq | `string \| null` | 消息唯一标识（递增序列号），用于匹配请求-响应 |
| topic | `string` | 频道主题，如 `realtime:room1` |
| event | `string` | 事件名称，如 `chan:join`, `broadcast` |
| payload | `object` | 消息内容 |

**示例**：

```json
// 加入频道 (join_seq="1", seq="1")
["1", "1", "realtime:room1", "chan:join", {"config": {...}}]

// 发送广播 (join_seq="1", seq="2")
["1", "2", "realtime:room1", "broadcast", {"type": "broadcast", "event": "msg", "payload": {...}}]

// 心跳 (join_seq=null, seq="3")
[null, "3", "$system", "heartbeat", {}]
```

---

### 3. 协议事件

#### 系统事件 (Channel 生命周期)

| Event | 方向 | 说明 |
|-------|------|------|
| `chan:join` | Client → Server | 加入频道请求 |
| `chan:leave` | Client → Server | 离开频道请求 |
| `chan:reply` | Server → Client | 请求响应 (成功/失败) |
| `chan:error` | Server → Client | 频道错误通知 |
| `chan:close` | Server → Client | 频道关闭通知 |
| `heartbeat` | Client → Server | 心跳检测 |
| `access_token` | Client → Server | 更新 JWT Token |

#### 业务事件

| Event | 方向 | 说明 |
|-------|------|------|
| `broadcast` | 双向 | 广播消息 |
| `presence` | 双向 | Presence 状态消息 |
| `presence_state` | Server → Client | Presence 全量状态 |
| `presence_diff` | Server → Client | Presence 增量更新 |
| `system` | Server → Client | 系统消息 |

---

### 4. 频道加入流程

#### 请求 (chan:join)

```json
{
  "topic": "realtime:room1",
  "event": "chan:join",
  "seq": "1",
  "join_seq": "1",
  "payload": {
    "config": {
      "broadcast": {
        "self": false,
        "ack": false
      },
      "presence": {
        "key": "",
        "enabled": true
      }
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 成功响应 (chan:reply)

```json
{
  "topic": "realtime:room1",
  "event": "chan:reply",
  "seq": "1",
  "payload": {
    "status": "ok",
    "response": {}
  }
}
```

#### 失败响应

```json
{
  "topic": "realtime:room1",
  "event": "chan:reply",
  "seq": "1",
  "payload": {
    "status": "error",
    "response": {
      "reason": "Invalid API key"
    }
  }
}
```

---

### 5. 心跳机制

#### 心跳请求

```json
{
  "topic": "$system",
  "event": "heartbeat",
  "seq": "5",
  "payload": {}
}
```

#### 心跳响应

```json
{
  "topic": "$system",
  "event": "chan:reply",
  "seq": "5",
  "payload": {
    "status": "ok",
    "response": {}
  }
}
```

#### 心跳状态

| 状态 | 说明 |
|------|------|
| `sent` | 心跳消息已发送 |
| `ok` | 服务端正常响应 |
| `error` | 服务端返回错误 |
| `timeout` | 心跳超时未响应 |
| `disconnected` | 连接已断开 |

#### 超时处理流程

```
发送心跳 → 记录 pendingHeartbeatSeq
    ↓
等待 25 秒
    ↓
下次心跳时检查 pendingHeartbeatSeq
    ↓
如果仍存在 → 认为超时
    ↓
关闭连接 (code=1000, reason='heartbeat timeout')
    ↓
触发指数退避重连
```

---

## 五、功能协议

### 1. Broadcast 消息

#### WebSocket 发送

```json
{
  "topic": "realtime:room1",
  "event": "broadcast",
  "seq": "3",
  "join_seq": "1",
  "payload": {
    "type": "broadcast",
    "event": "cursor_move",
    "payload": {
      "x": 100,
      "y": 200,
      "userId": "user-123"
    }
  }
}
```

#### REST API 发送

```http
POST /api/broadcast HTTP/1.1
Host: your-server.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "messages": [
    {
      "topic": "room1",
      "event": "cursor_move",
      "payload": {
        "x": 100,
        "y": 200,
        "userId": "user-123"
      }
    }
  ]
}
```

**响应**：

```json
// 成功 (HTTP 202)
{}

// 失败
{
  "error": "Unauthorized"
}
```

#### 接收广播

```json
{
  "topic": "realtime:room1",
  "event": "broadcast",
  "seq": null,
  "payload": {
    "type": "broadcast",
    "event": "cursor_move",
    "payload": {
      "x": 100,
      "y": 200,
      "userId": "user-123"
    },
    "meta": {
      "id": "broadcast-msg-abc123",
      "replayed": false
    }
  }
}
```

#### 代码示例

```typescript
// 发送广播 (WebSocket)
await channel.send({
  type: 'broadcast',
  event: 'cursor_move',
  payload: { x: 100, y: 200 },
})

// 发送广播 (REST API) - 推荐用于可靠性要求高的场景
const result = await channel.httpSend('cursor_move', { x: 100, y: 200 })
if (result.success) {
  console.log('Broadcast sent via REST')
}

// 监听广播
channel.on('broadcast', { event: 'cursor_move' }, (payload) => {
  console.log('Cursor:', payload.payload.x, payload.payload.y)
})
```

---

### 2. Presence 协议

#### Track (发送在线状态)

```json
{
  "topic": "realtime:room1",
  "event": "presence",
  "seq": "4",
  "join_seq": "1",
  "payload": {
    "type": "presence",
    "event": "track",
    "payload": {
      "user_id": "123",
      "username": "Alice",
      "status": "online",
      "typing": false
    }
  }
}
```

#### Untrack (移除在线状态)

```json
{
  "topic": "realtime:room1",
  "event": "presence",
  "seq": "5",
  "join_seq": "1",
  "payload": {
    "type": "presence",
    "event": "untrack"
  }
}
```

#### presence_state (全量状态)

服务端在客户端加入频道后发送当前所有在线用户状态：

```json
{
  "topic": "realtime:room1",
  "event": "presence_state",
  "seq": null,
  "payload": {
    "user_123": {
      "metas": [
        {
          "session_ref": "ref-abc",
          "user_id": "123",
          "username": "Alice",
          "status": "online"
        }
      ]
    },
    "user_456": {
      "metas": [
        {
          "session_ref": "ref-def",
          "user_id": "456",
          "username": "Bob",
          "status": "away"
        },
        {
          "session_ref": "ref-ghi",
          "user_id": "456",
          "username": "Bob",
          "status": "online"
        }
      ]
    }
  }
}
```

> 注意：同一用户可能有多个 `metas` 条目，表示多设备同时在线。

#### presence_diff (增量更新)

```json
{
  "topic": "realtime:room1",
  "event": "presence_diff",
  "seq": null,
  "payload": {
    "joins": {
      "user_789": {
        "metas": [
          {
            "session_ref": "ref-jkl",
            "user_id": "789",
            "username": "Charlie",
            "status": "online"
          }
        ]
      }
    },
    "leaves": {
      "user_456": {
        "metas": [
          {
            "session_ref": "ref-def",
            "user_id": "456",
            "username": "Bob",
            "status": "away"
          }
        ]
      }
    }
  }
}
```

#### 客户端状态转换

客户端 `RealtimePresence` 类会将服务端的 `metas` 格式转换为更简洁的格式：

```typescript
// 服务端格式
{
  "user_123": {
    "metas": [
      { "session_ref": "ref-abc", "status": "online" }
    ]
  }
}

// 客户端转换后
{
  "user_123": [
    { "presence_ref": "ref-abc", "status": "online" }
  ]
}
```

#### 代码示例

```typescript
// 追踪在线状态
await channel.track({
  user_id: currentUser.id,
  username: currentUser.name,
  status: 'online',
  last_seen: new Date().toISOString(),
})

// 停止追踪
await channel.untrack()

// 获取当前在线用户
const state = channel.presenceState()
console.log('Online users:', Object.keys(state))

// 监听 Presence 事件
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState()
  updateOnlineUsersList(state)
})

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`${key} joined with`, newPresences)
})

channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
  console.log(`${key} left`, leftPresences)
})
```

---

## 六、状态机

### Client 连接状态

```
                    ┌──────────────────┐
                    │   disconnected   │
                    └────────┬─────────┘
                             │ connect()
                             ▼
                    ┌──────────────────┐
              ┌─────│    connecting    │─────┐
              │     └────────┬─────────┘     │
              │              │ onopen        │ onerror
              │              ▼               │
              │     ┌──────────────────┐     │
              │     │    connected     │     │
              │     └────────┬─────────┘     │
              │              │ disconnect()  │
              │              ▼               │
              │     ┌──────────────────┐     │
              └────→│  disconnecting   │←────┘
                    └────────┬─────────┘
                             │ onclose
                             ▼
                    ┌──────────────────┐
                    │   disconnected   │
                    └──────────────────┘
```

### Channel 订阅状态

```
                    ┌──────────────────┐
                    │      closed      │
                    └────────┬─────────┘
                             │ subscribe()
                             ▼
                    ┌──────────────────┐
              ┌─────│     joining      │─────┐
              │     └────────┬─────────┘     │
              │              │ ok            │ error/timeout
              │              ▼               │
              │     ┌──────────────────┐     │
              │     │      joined      │     │
              │     └────────┬─────────┘     │
              │              │ unsubscribe() │
              │              ▼               │
              │     ┌──────────────────┐     │
              │     │     leaving      │     │
              │     └────────┬─────────┘     │
              │              │ ok/timeout    │
              │              ▼               ▼
              │     ┌──────────────────┐   ┌──────────────────┐
              └────→│      closed      │   │     errored      │
                    └──────────────────┘   └────────┬─────────┘
                                                    │ rejoin
                                                    └──→ joining
```

---

## 七、请求-响应匹配机制

Realtime 使用 `seq` 字段实现请求-响应的匹配。

### 工作原理

```
Client                                Server
   │                                     │
   │  1. 生成唯一 seq（递增）             │
   │  2. 注册 chan_reply_{seq} 监听器     │
   │  3. 设置超时定时器                   │
   │                                     │
   │  push({ seq: "5", ... })            │
   ├────────────────────────────────────→│
   │                                     │
   │     { seq: "5", event: "chan:reply",│
   │       payload: { status: "ok" } }   │
   │←────────────────────────────────────┤
   │                                     │
   │  4. 通过 seq 匹配响应               │
   │  5. 触发 receive('ok', callback)    │
   │  6. 清理监听器和定时器              │
   └─────────────────────────────────────┘
```

### Push 类实现

```typescript
class Push {
  seq: string = ''
  recHooks: { status: string; callback: Function }[] = []

  send() {
    this.startTimeout()
    this.channel.socket.push({
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload,
      seq: this.seq,
      join_seq: this.channel._joinSeq(),
    })
  }

  startTimeout() {
    this.seq = this.channel.socket._makeSeq()  // 生成唯一 seq（递增）
    this.seqEvent = `chan_reply_${this.seq}`

    // 注册响应监听器
    this.channel._on(this.seqEvent, {}, (payload) => {
      this._matchReceive(payload)
    })

    // 设置超时定时器
    this.timeoutTimer = setTimeout(() => {
      this.trigger('timeout', {})
    }, this.timeout)
  }

  receive(status: string, callback: Function) {
    this.recHooks.push({ status, callback })
    return this  // 支持链式调用
  }
}
```

### 使用示例

```typescript
channel._push('broadcast', { event: 'test', payload: {} })
  .receive('ok', (response) => {
    console.log('Broadcast acknowledged:', response)
  })
  .receive('error', (error) => {
    console.error('Broadcast failed:', error)
  })
  .receive('timeout', () => {
    console.warn('Broadcast timed out')
  })
```

---

## 八、重连与容错

### 重连策略

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 重连间隔 | `[1000, 2000, 5000, 10000]` ms | 前 4 次重连的间隔 |
| 最大间隔 | `10000` ms | 第 5 次及之后的重连间隔 |
| 心跳间隔 | `25000` ms | 心跳检测间隔 |
| 心跳超时 | 下次心跳时检测 | 如果上次心跳未响应则认为超时 |

### 指数退避实现

```typescript
reconnectAfterMs: (tries: number) => {
  const intervals = [1000, 2000, 5000, 10000]
  return intervals[tries - 1] || 10000
}
```

### 消息缓冲

| 缓冲类型 | 大小限制 | 说明 |
|---------|---------|------|
| Client sendBuffer | 无限制 | WebSocket 断开时缓存待发送消息 |
| Channel pushBuffer | 100 条 | Channel 未 joined 时缓存消息，超过时丢弃最旧的 |

### 自动重加入

Channel 在连接恢复后会自动尝试重新加入：

```typescript
// RealtimeChannel 构造函数中
this.rejoinTimer = new Timer(
  () => this._rejoinUntilConnected(),
  this.socket.reconnectAfterMs
)

// 连接错误时触发
this._onError((reason) => {
  this.state = CHANNEL_STATES.errored
  this.rejoinTimer.scheduleTimeout()
})
```

### Token 自动刷新

```typescript
// 心跳时自动刷新 (仅 callback-based token)
async sendHeartbeat() {
  // ...
  this._setAuthSafely('heartbeat')
}

// 手动设置的 token 不会被自动刷新
client.setAuth('manual-token')  // _manuallySetToken = true

// 恢复使用 accessToken 回调
client.setAuth()  // _manuallySetToken = false
```

---

## 九、错误处理

### 1. 错误响应格式

所有错误都通过 `chan:reply` 事件返回，格式统一：

```json
{
  "topic": "realtime:room1",
  "event": "chan:reply",
  "seq": "1",
  "payload": {
    "status": "error",
    "response": {
      "code": "AUTH_EXPIRED",
      "reason": "Token has expired"
    }
  }
}
```

### 2. 错误码定义

#### 认证错误 (AUTH_*)

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `AUTH_MISSING` | 未提供 access_token | 检查 token 配置 |
| `AUTH_INVALID` | Token 格式无效或签名错误 | 重新获取 token |
| `AUTH_EXPIRED` | Token 已过期 | 调用 `setAuth()` 刷新 token |
| `AUTH_REVOKED` | Token 已被撤销 | 重新登录获取新 token |

#### 频道错误 (CHANNEL_*)

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `CHANNEL_NOT_FOUND` | 频道不存在 | 检查 topic 名称 |
| `CHANNEL_FULL` | 频道已达最大连接数 | 稍后重试或选择其他频道 |
| `CHANNEL_FORBIDDEN` | 无权加入该频道 | 检查用户权限 |
| `CHANNEL_ALREADY_JOINED` | 已加入该频道 | 无需重复加入 |

#### 消息错误 (MESSAGE_*)

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `MESSAGE_TOO_LARGE` | 消息超过 100KB 限制 | 减小 payload 大小 |
| `MESSAGE_INVALID` | 消息格式无效 | 检查 payload 结构 |
| `MESSAGE_RATE_LIMITED` | 发送频率超限 | 降低发送频率 |

#### 系统错误 (SYSTEM_*)

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `SYSTEM_OVERLOAD` | 服务端过载 | 使用指数退避重试 |
| `SYSTEM_MAINTENANCE` | 服务维护中 | 等待维护结束 |
| `SYSTEM_INTERNAL` | 服务端内部错误 | 联系管理员 |

#### Presence 错误 (PRESENCE_*)

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `PRESENCE_DISABLED` | 频道未启用 Presence | 在 config 中启用 presence |
| `PRESENCE_PAYLOAD_TOO_LARGE` | Presence 数据超过限制 | 减小 track payload |
| `PRESENCE_KEY_CONFLICT` | Presence key 冲突 | 使用唯一的 presence key |

### 3. WebSocket 关闭码

| 关闭码 | 常量名 | 说明 |
|--------|--------|------|
| `1000` | `WS_CLOSE_NORMAL` | 正常关闭 |
| `1001` | `WS_CLOSE_GOING_AWAY` | 客户端离开（如页面关闭） |
| `1006` | `WS_CLOSE_ABNORMAL` | 异常关闭（无 close frame） |
| `1008` | `WS_CLOSE_POLICY_VIOLATION` | 违反策略（如认证失败） |
| `1009` | `WS_CLOSE_MESSAGE_TOO_BIG` | 消息过大 |
| `1011` | `WS_CLOSE_INTERNAL_ERROR` | 服务端内部错误 |
| `4000` | `WS_CLOSE_AUTH_ERROR` | 认证错误（自定义） |
| `4001` | `WS_CLOSE_TOKEN_EXPIRED` | Token 过期（自定义） |
| `4002` | `WS_CLOSE_RATE_LIMITED` | 速率限制（自定义） |
| `4003` | `WS_CLOSE_CHANNEL_ERROR` | 频道错误（自定义） |

### 4. 客户端错误处理示例

```typescript
// 全局连接错误处理
client.onError((error) => {
  console.error('Connection error:', error)
})

// 频道级错误处理
channel.subscribe((status, err) => {
  if (status === 'CHANNEL_ERROR') {
    const { code, reason } = err

    switch (code) {
      case 'AUTH_EXPIRED':
        // 刷新 token 后重新订阅
        await client.setAuth(await getNewToken())
        channel.subscribe()
        break

      case 'CHANNEL_FULL':
        // 提示用户稍后重试
        showMessage('频道已满，请稍后重试')
        break

      case 'CHANNEL_FORBIDDEN':
        // 权限不足
        showMessage('您没有权限加入此频道')
        break

      default:
        console.error(`Channel error [${code}]: ${reason}`)
    }
  }
})

// 消息发送错误处理
const result = await channel.send({
  type: 'broadcast',
  event: 'message',
  payload: largeData,
})

if (result.status === 'error') {
  if (result.code === 'MESSAGE_TOO_LARGE') {
    // 分片发送或压缩数据
  }
}
```

### 5. 服务端主动推送的错误

服务端可能主动推送 `chan:error` 事件：

```json
{
  "topic": "realtime:room1",
  "event": "chan:error",
  "seq": null,
  "payload": {
    "code": "SYSTEM_MAINTENANCE",
    "reason": "Server will restart in 5 minutes",
    "details": {
      "maintenance_start": "2024-01-15T10:00:00Z",
      "estimated_duration": 300
    }
  }
}
```

客户端监听：

```typescript
channel.on('system', { event: 'error' }, ({ code, reason, details }) => {
  if (code === 'SYSTEM_MAINTENANCE') {
    showMaintenanceWarning(details.estimated_duration)
  }
})
```

---

## 十、限制与配额

### 1. 消息限制

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| 单条消息最大大小 | **100 KB** | 超过返回 `MESSAGE_TOO_LARGE` |
| Presence payload 最大大小 | **10 KB** | 超过返回 `PRESENCE_PAYLOAD_TOO_LARGE` |
| Topic 名称最大长度 | **255** 字符 | 仅支持字母、数字、`-`、`_`、`:` |
| Event 名称最大长度 | **128** 字符 | |

### 2. 连接限制

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| 单个 IP 最大连接数 | **100** | 防止连接滥用 |
| 单个连接最大订阅频道数 | **100** | 超过返回错误 |
| 连接空闲超时 | **60 秒** | 无心跳且无频道时断开 |

### 3. 频道限制

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| 单个频道最大连接数 | **10,000** | 超过返回 `CHANNEL_FULL` |
| 单个频道最大 Presence 数 | **1,000** | 超过时最早的 presence 被移除 |

### 4. 速率限制

| 操作 | 限制 | 窗口 |
|------|------|------|
| 消息发送 | **100** 条/连接 | 每秒 |
| 频道加入 | **10** 次/连接 | 每秒 |
| Presence track | **10** 次/连接 | 每秒 |
| 连接建立 | **10** 次/IP | 每秒 |

#### 速率限制响应

当触发速率限制时，服务端返回：

```json
{
  "topic": "realtime:room1",
  "event": "chan:reply",
  "seq": "10",
  "payload": {
    "status": "error",
    "response": {
      "code": "MESSAGE_RATE_LIMITED",
      "reason": "Rate limit exceeded",
      "retry_after": 1000
    }
  }
}
```

客户端处理：

```typescript
channel.send(message)
  .receive('error', (response) => {
    if (response.code === 'MESSAGE_RATE_LIMITED') {
      // 等待 retry_after 毫秒后重试
      setTimeout(() => {
        channel.send(message)
      }, response.retry_after)
    }
  })
```

### 5. 消息缓冲限制

| 缓冲类型 | 大小限制 | 超出行为 |
|---------|---------|----------|
| Client sendBuffer | **1000** 条 | 丢弃最旧的消息 |
| Channel pushBuffer | **100** 条 | 丢弃最旧的消息 |

---

## 十一、常量与枚举

### 连接状态

```typescript
enum SOCKET_STATES {
  connecting = 0,
  open = 1,
  closing = 2,
  closed = 3,
}

enum CONNECTION_STATE {
  Connecting = 'connecting',
  Open = 'open',
  Closing = 'closing',
  Closed = 'closed',
}
```

### 频道状态

```typescript
enum CHANNEL_STATES {
  closed = 'closed',
  errored = 'errored',
  joined = 'joined',
  joining = 'joining',
  leaving = 'leaving',
}
```

### 事件类型

```typescript
enum CHANNEL_EVENTS {
  close = 'chan:close',
  error = 'chan:error',
  join = 'chan:join',
  reply = 'chan:reply',
  leave = 'chan:leave',
  access_token = 'access_token',
}

enum REALTIME_LISTEN_TYPES {
  BROADCAST = 'broadcast',
  PRESENCE = 'presence',
  SYSTEM = 'system',
}

enum REALTIME_PRESENCE_LISTEN_EVENTS {
  SYNC = 'sync',
  JOIN = 'join',
  LEAVE = 'leave',
}
```

### 订阅状态

```typescript
enum REALTIME_SUBSCRIBE_STATES {
  SUBSCRIBED = 'SUBSCRIBED',
  TIMED_OUT = 'TIMED_OUT',
  CLOSED = 'CLOSED',
  CHANNEL_ERROR = 'CHANNEL_ERROR',
}
```

### 错误码

```typescript
enum ERROR_CODE {
  // 认证错误
  AUTH_MISSING = 'AUTH_MISSING',
  AUTH_INVALID = 'AUTH_INVALID',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_REVOKED = 'AUTH_REVOKED',

  // 频道错误
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_FULL = 'CHANNEL_FULL',
  CHANNEL_FORBIDDEN = 'CHANNEL_FORBIDDEN',
  CHANNEL_ALREADY_JOINED = 'CHANNEL_ALREADY_JOINED',

  // 消息错误
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  MESSAGE_INVALID = 'MESSAGE_INVALID',
  MESSAGE_RATE_LIMITED = 'MESSAGE_RATE_LIMITED',

  // 系统错误
  SYSTEM_OVERLOAD = 'SYSTEM_OVERLOAD',
  SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE',
  SYSTEM_INTERNAL = 'SYSTEM_INTERNAL',

  // Presence 错误
  PRESENCE_DISABLED = 'PRESENCE_DISABLED',
  PRESENCE_PAYLOAD_TOO_LARGE = 'PRESENCE_PAYLOAD_TOO_LARGE',
  PRESENCE_KEY_CONFLICT = 'PRESENCE_KEY_CONFLICT',
}
```

### WebSocket 关闭码

```typescript
enum WS_CLOSE_CODE {
  // 标准关闭码
  NORMAL = 1000,
  GOING_AWAY = 1001,
  PROTOCOL_ERROR = 1002,
  UNSUPPORTED_DATA = 1003,
  ABNORMAL = 1006,
  INVALID_PAYLOAD = 1007,
  POLICY_VIOLATION = 1008,
  MESSAGE_TOO_BIG = 1009,
  INTERNAL_ERROR = 1011,

  // 自定义关闭码 (4000-4999)
  AUTH_ERROR = 4000,
  TOKEN_EXPIRED = 4001,
  RATE_LIMITED = 4002,
  CHANNEL_ERROR = 4003,
}
```

### 默认配置

```typescript
const DEFAULT_TIMEOUT = 10000        // 10 秒
const HEARTBEAT_INTERVAL = 25000     // 25 秒
const MAX_PUSH_BUFFER_SIZE = 100     // Channel 最大缓冲消息数
const MAX_SEND_BUFFER_SIZE = 1000    // Client 最大缓冲消息数
const WS_CLOSE_NORMAL = 1000         // 正常关闭代码

const PROTOCOL_VERSION = '1.0.0'     // 协议版本
const SYSTEM_TOPIC = '$system'       // 系统消息 Topic

// 限制
const MAX_MESSAGE_SIZE = 102400      // 100 KB
const MAX_PRESENCE_SIZE = 10240      // 10 KB
const MAX_TOPIC_LENGTH = 255         // 字符
const MAX_EVENT_LENGTH = 128         // 字符
const MAX_CHANNELS_PER_CONNECTION = 100
const MAX_CONNECTIONS_PER_CHANNEL = 10000
const MAX_PRESENCE_PER_CHANNEL = 1000
```

---

## 附录：完整使用示例

```typescript
import { RealtimeClient } from 'realtime-js'

// 创建客户端
const client = new RealtimeClient('wss://your-server.com/realtime/v1', {
  accessToken: async () => {
    // 从你的认证系统获取 token
    return await getAccessToken()
  },
  heartbeatIntervalMs: 25000,
  timeout: 10000,
})

// 心跳监控
client.onHeartbeat((status) => {
  if (status === 'timeout') {
    console.warn('Connection unstable')
  }
})

// 创建频道
const channel = client.channel('room:123', {
  config: {
    broadcast: { self: true, ack: true },
    presence: { key: 'user-id' },
  },
})

// 监听广播
channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log('New message:', payload.payload)
})

// 监听 Presence
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState()
  console.log('Online users:', Object.keys(state).length)
})

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`${key} joined`)
})

channel.on('presence', { event: 'leave' }, ({ key }) => {
  console.log(`${key} left`)
})

// 订阅
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    // 追踪 Presence
    await channel.track({
      user_id: 'current-user',
      online_at: new Date().toISOString(),
    })

    // 发送广播
    await channel.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: 'Hello!' },
    })
  }
})

// 清理
async function cleanup() {
  await channel.untrack()
  await client.removeChannel(channel)
  client.disconnect()
}
```

# Realtime Message

[English](#english) | [中文](#中文)

---

<a name="english"></a>
## English

A real-time messaging system with WebSocket support, featuring channels, broadcast, presence, and horizontal scaling via Redis.

### Features

- **WebSocket Communication** - Real-time bidirectional communication
- **Channel System** - Topic-based message routing
- **Broadcast** - Send messages to all channel members
- **Presence** - Track online users in channels
- **Redis Pub/Sub** - Horizontal scaling across multiple server instances
- **JWT Authentication** - Secure channel access with token-based auth
- **Auto Reconnection** - Automatic reconnection with channel rejoin
- **REST API** - HTTP endpoints for server-side broadcasting

### Project Structure

```
realtime-message/
├── packages/
│   ├── sdk/           # Client SDK (TypeScript)
│   ├── server/        # Server (Hono + ws)
│   └── shared/        # Shared types and constants
└── examples/          # Test scripts
```

### Quick Start

#### Installation

```bash
# Clone and install dependencies
git clone <repo-url>
cd realtime-message
npm install

# Build all packages
npm run build
```

#### Start Server

```bash
# Development mode
npm run dev:server

# With Redis support
REDIS_ENABLED=true npm run dev:server

# With JWT authentication
AUTH_ENABLED=true AUTH_SECRET=your-secret npm run dev:server
```

#### Client Usage

```typescript
import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '@realtime-message/sdk'

// Create client
const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 25000,
  // For authenticated servers:
  // token: 'your-jwt-token',
  // Or use async callback:
  // accessToken: async () => fetchToken(),
})

// Connect
client.connect()

// Subscribe to a channel
const channel = client.channel('room:lobby', {
  config: {
    broadcast: { self: false, ack: true },
    presence: { key: 'user-123' },
  },
})

// Listen for broadcasts
channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log('Received:', payload)
})

// Listen for presence events
channel.on('presence', { event: 'sync' }, () => {
  console.log('Online users:', channel.presenceState())
})

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`${key} joined`)
})

// Subscribe to channel
channel.subscribe((status) => {
  if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
    // Send a broadcast message
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: 'Hello!' },
    })

    // Track presence
    channel.track({ user_id: 'user-123', status: 'online' })
  }
})

// Cleanup
await client.removeAllChannels()
client.disconnect()
```

### REST API

#### Broadcast Message

```bash
POST /api/broadcast
Content-Type: application/json
Authorization: Bearer <token>  # Required if AUTH_ENABLED

{
  "topic": "room:lobby",
  "event": "notification",
  "payload": { "message": "Hello from server!" }
}
```

#### Get Channel Info

```bash
GET /api/channels/:topic
```

#### Health Check

```bash
GET /health
```

### Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `4000` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | - |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | - |
| `AUTH_ENABLED` | Enable JWT authentication | `false` |
| `AUTH_SECRET` | JWT secret key | - |
| `AUTH_ISSUER` | JWT issuer (optional) | - |
| `AUTH_AUDIENCE` | JWT audience (optional) | - |

Get `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from your [Upstash Redis Console](https://console.upstash.com/).

### Running Tests

```bash
# Start server first
npm run dev:server

# Run individual tests
node examples/test-broadcast.mjs
node examples/test-presence.mjs
node examples/test-reconnection-simple.mjs
node examples/test-rest-api.mjs

# JWT auth test (requires AUTH_ENABLED=true)
AUTH_ENABLED=true AUTH_SECRET=test-secret npm run dev:server
node examples/test-jwt-auth.mjs

# Multi-instance test (requires Upstash Redis)
# Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env
PORT=4000 npm run dev:server
PORT=4001 npm run dev:server
node examples/test-redis-multi-instance.mjs
```

---

<a name="中文"></a>
## 中文

一个支持 WebSocket 的实时消息系统，具有频道、广播、在线状态追踪功能，并支持通过 Redis 进行水平扩展。

### 功能特性

- **WebSocket 通信** - 实时双向通信
- **频道系统** - 基于主题的消息路由
- **广播消息** - 向频道内所有成员发送消息
- **在线状态** - 追踪频道内的在线用户
- **Redis Pub/Sub** - 支持多服务实例水平扩展
- **JWT 认证** - 基于令牌的安全频道访问
- **自动重连** - 断线自动重连并重新加入频道
- **REST API** - 服务端 HTTP 广播接口

### 项目结构

```
realtime-message/
├── packages/
│   ├── sdk/           # 客户端 SDK (TypeScript)
│   ├── server/        # 服务端 (Hono + ws)
│   └── shared/        # 共享类型和常量
└── examples/          # 测试脚本
```

### 快速开始

#### 安装

```bash
# 克隆并安装依赖
git clone <repo-url>
cd realtime-message
npm install

# 构建所有包
npm run build
```

#### 启动服务器

```bash
# 开发模式
npm run dev:server

# 启用 Redis 支持
REDIS_ENABLED=true npm run dev:server

# 启用 JWT 认证
AUTH_ENABLED=true AUTH_SECRET=your-secret npm run dev:server
```

#### 客户端使用

```typescript
import { RealtimeClient, REALTIME_SUBSCRIBE_STATES } from '@realtime-message/sdk'

// 创建客户端
const client = new RealtimeClient('ws://localhost:4000', {
  heartbeatIntervalMs: 25000,
  // 认证服务器需要:
  // token: 'your-jwt-token',
  // 或使用异步回调:
  // accessToken: async () => fetchToken(),
})

// 连接
client.connect()

// 订阅频道
const channel = client.channel('room:lobby', {
  config: {
    broadcast: { self: false, ack: true },
    presence: { key: 'user-123' },
  },
})

// 监听广播消息
channel.on('broadcast', { event: 'message' }, (payload) => {
  console.log('收到消息:', payload)
})

// 监听在线状态事件
channel.on('presence', { event: 'sync' }, () => {
  console.log('在线用户:', channel.presenceState())
})

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`${key} 加入了`)
})

// 订阅频道
channel.subscribe((status) => {
  if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
    // 发送广播消息
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: '你好！' },
    })

    // 追踪在线状态
    channel.track({ user_id: 'user-123', status: 'online' })
  }
})

// 清理
await client.removeAllChannels()
client.disconnect()
```

### REST API

#### 广播消息

```bash
POST /api/broadcast
Content-Type: application/json
Authorization: Bearer <token>  # AUTH_ENABLED 时需要

{
  "topic": "room:lobby",
  "event": "notification",
  "payload": { "message": "来自服务器的消息！" }
}
```

#### 获取频道信息

```bash
GET /api/channels/:topic
```

#### 健康检查

```bash
GET /health
```

### 环境变量

在项目根目录创建 `.env` 文件（从 `.env.example` 复制）：

```bash
cp .env.example .env
```

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `4000` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | - |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | - |
| `AUTH_ENABLED` | 启用 JWT 认证 | `false` |
| `AUTH_SECRET` | JWT 密钥 | - |
| `AUTH_ISSUER` | JWT 签发者 (可选) | - |
| `AUTH_AUDIENCE` | JWT 受众 (可选) | - |

从 [Upstash Redis 控制台](https://console.upstash.com/) 获取 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。

### 运行测试

```bash
# 先启动服务器
npm run dev:server

# 运行各项测试
node examples/test-broadcast.mjs
node examples/test-presence.mjs
node examples/test-reconnection-simple.mjs
node examples/test-rest-api.mjs

# JWT 认证测试 (需要 AUTH_ENABLED=true)
AUTH_ENABLED=true AUTH_SECRET=test-secret npm run dev:server
node examples/test-jwt-auth.mjs

# 多实例测试 (需要 Upstash Redis)
# 在 .env 中设置 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN
PORT=4000 npm run dev:server
PORT=4001 npm run dev:server
node examples/test-redis-multi-instance.mjs
```

### 协议格式

消息采用 JSON 数组格式：

```
[join_seq, seq, topic, event, payload]
```

- `join_seq` - 加入序列号（用于关联频道）
- `seq` - 消息序列号（用于请求-响应匹配）
- `topic` - 频道主题
- `event` - 事件类型
- `payload` - 消息内容

### 许可证

MIT

---

## API Reference | API 参考

### RealtimeClient

| Method | Description | 描述 |
|--------|-------------|------|
| `connect()` | Connect to server | 连接服务器 |
| `disconnect()` | Disconnect from server | 断开连接 |
| `isConnected()` | Check connection status | 检查连接状态 |
| `channel(topic, options)` | Create/get a channel | 创建/获取频道 |
| `removeChannel(channel)` | Remove a channel | 移除频道 |
| `removeAllChannels()` | Remove all channels | 移除所有频道 |
| `setAuth(token)` | Set authentication token | 设置认证令牌 |
| `onOpen(callback)` | Connection open callback | 连接打开回调 |
| `onClose(callback)` | Connection close callback | 连接关闭回调 |
| `onError(callback)` | Error callback | 错误回调 |

### RealtimeChannel

| Method | Description | 描述 |
|--------|-------------|------|
| `subscribe(callback)` | Subscribe to channel | 订阅频道 |
| `unsubscribe()` | Unsubscribe from channel | 取消订阅 |
| `on(type, filter, callback)` | Listen for events | 监听事件 |
| `send(message)` | Send broadcast message | 发送广播消息 |
| `track(meta)` | Track presence | 追踪在线状态 |
| `untrack()` | Untrack presence | 取消追踪 |
| `presenceState()` | Get presence state | 获取在线状态 |
| `isJoined()` | Check if joined | 检查是否已加入 |

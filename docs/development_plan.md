# Realtime Message System 开发计划

> 渐进式开发，每个迭代都可独立运行和测试

## 项目概述

- **SDK (Client)**: TypeScript WebSocket 客户端库
- **Service (Server)**: TypeScript WebSocket 服务端，使用 Redis 支持多实例
- **开发原则**: 每个迭代完成后都有可运行的端到端功能

---

## 项目结构

```
realtime-message2/
├── packages/
│   ├── sdk/                    # 客户端 SDK
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/                 # 服务端
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/                 # 共享类型和常量
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── examples/                   # 示例代码
├── package.json               # Monorepo 根配置 (npm workspaces)
└── tsconfig.base.json         # 共享 TS 配置
```

---

## 技术选型

| 组件 | 选择 | 原因 |
|------|------|------|
| 包管理器 | **npm workspaces** | 原生支持，无需额外安装 |
| 构建工具 | tsup | 简单快速的 TS 构建 |
| 测试框架 | vitest | 快速，TS 原生支持 |
| Server WS | ws | Node.js 标准 WebSocket 库 |
| Redis | ioredis | 功能完整，支持 Cluster |
| HTTP | **Hono** | 轻量现代，TypeScript 优先 |
| Redis 端口 | **6379** | 本地默认端口 |

---

## 迭代计划

### 迭代 1: 项目脚手架 + 基础连接

**目标**: 建立 monorepo 结构，实现最基础的 WebSocket 连接

#### 1.1 Monorepo 初始化
- [ ] 创建根 `package.json` (npm workspaces 配置, scripts: build, dev, test)
- [ ] 创建 `tsconfig.base.json` (共享 TS 配置)

#### 1.2 Shared 包
- [ ] `packages/shared/src/constants.ts` - 基础常量
  - SOCKET_STATES, CONNECTION_STATE
  - CHANNEL_EVENTS (chan:join, chan:reply, heartbeat)
  - DEFAULT_TIMEOUT, HEARTBEAT_INTERVAL
- [ ] `packages/shared/src/types.ts` - 基础类型
  - Message 格式: `[join_seq, seq, topic, event, payload]`
  - RealtimeClientOptions, RealtimeChannelOptions

#### 1.3 Server 基础
- [ ] `packages/server/src/index.ts` - HTTP + WebSocket 服务器
  - 使用 `ws` 库创建 WebSocket 服务
  - 接受连接，打印日志
  - 简单的心跳响应

#### 1.4 SDK 基础
- [ ] `packages/sdk/src/RealtimeClient.ts`
  - connect() / disconnect()
  - 基础状态管理 (connecting/connected/disconnected)
  - 心跳发送和响应检测
- [ ] `packages/sdk/src/index.ts` - 导出

#### 1.5 验收测试
```typescript
// 可运行的示例
const client = new RealtimeClient('ws://localhost:4000')
client.connect()
// 观察心跳日志
client.disconnect()
```

**产出**: 客户端能连接服务端，心跳正常工作

---

### 迭代 2: 频道加入与消息序列化

**目标**: 实现频道加入流程和 seq 请求-响应匹配

#### 2.1 Shared 扩展
- [ ] `packages/shared/src/serializer.ts` - JSON 消息编解码
- [ ] 补充 types: ChannelConfig, JoinPayload, ReplyPayload

#### 2.2 Server 频道管理
- [ ] `packages/server/src/ChannelManager.ts`
  - 频道创建和管理
  - 客户端加入/离开频道
  - 频道成员列表
- [ ] 处理 `chan:join` 和 `chan:leave` 事件
- [ ] 返回 `chan:reply` 响应

#### 2.3 SDK 频道实现
- [ ] `packages/sdk/src/lib/push.ts` - 消息推送与 seq 匹配
- [ ] `packages/sdk/src/lib/timer.ts` - 超时定时器
- [ ] `packages/sdk/src/RealtimeChannel.ts`
  - subscribe() / unsubscribe()
  - 状态管理 (closed/joining/joined/leaving)
  - 超时处理

#### 2.4 验收测试
```typescript
const client = new RealtimeClient('ws://localhost:4000')
client.connect()

const channel = client.channel('room:123')
channel.subscribe((status) => {
  console.log('Subscribe status:', status) // SUBSCRIBED
})
```

**产出**: 客户端能加入/离开频道，服务端正确响应

---

### 迭代 3: Broadcast 消息广播

**目标**: 实现频道内消息广播功能

#### 3.1 Server Broadcast
- [ ] `packages/server/src/BroadcastHandler.ts`
  - 接收 broadcast 事件
  - 广播给频道内所有成员（排除发送者，除非 self=true）
  - 支持 ack 确认

#### 3.2 SDK Broadcast
- [ ] `RealtimeChannel.send()` 方法
- [ ] `RealtimeChannel.on('broadcast', filter, callback)` 监听
- [ ] Broadcast config: { self, ack }

#### 3.3 验收测试
```typescript
// Client A
channelA.on('broadcast', { event: 'message' }, (payload) => {
  console.log('Received:', payload)
})

// Client B
channelB.send({
  type: 'broadcast',
  event: 'message',
  payload: { text: 'Hello!' }
})
```

**产出**: 多个客户端可以在频道内互发消息

---

### 迭代 4: Presence 在线状态

**目标**: 实现用户在线状态追踪

#### 4.1 Server Presence
- [ ] `packages/server/src/PresenceManager.ts`
  - track/untrack 处理
  - presence_state 全量同步
  - presence_diff 增量更新
  - 连接断开时自动 untrack

#### 4.2 SDK Presence
- [ ] `packages/sdk/src/RealtimePresence.ts`
  - 状态存储和同步
  - join/leave 事件计算
- [ ] `RealtimeChannel.track()` / `untrack()`
- [ ] `RealtimeChannel.presenceState()`
- [ ] Presence 事件监听 (sync/join/leave)

#### 4.3 验收测试
```typescript
channel.on('presence', { event: 'sync' }, () => {
  console.log('Online users:', channel.presenceState())
})

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  console.log(`${key} joined`)
})

await channel.track({ user_id: 'user-123', status: 'online' })
```

**产出**: 可以追踪频道内用户的在线状态

---

### 迭代 5: Redis 集成与多实例支持

**目标**: 使用 Redis Pub/Sub 支持服务端多实例

#### 5.1 Redis 集成
- [ ] `packages/server/src/redis/RedisAdapter.ts`
  - Redis 连接管理
  - Pub/Sub 订阅频道消息
- [ ] `packages/server/src/redis/RedisPubSub.ts`
  - 跨实例消息广播
  - Presence 状态同步

#### 5.2 Server 改造
- [ ] ChannelManager 使用 Redis 存储频道成员
- [ ] Broadcast 通过 Redis Pub/Sub 分发
- [ ] Presence 状态存储到 Redis

#### 5.3 验收测试
```bash
# 启动两个服务实例
node server.js --port 4000
node server.js --port 4001

# Client A 连接 4000，Client B 连接 4001
# 两者加入同一频道，消息能互通
```

**产出**: 服务端支持水平扩展

---

### 迭代 6: 认证与错误处理

**目标**: 实现 JWT 认证和完整的错误处理

#### 6.1 Server 认证
- [ ] `packages/server/src/auth/JwtVerifier.ts`
  - JWT 验证
  - Token 过期检查
- [ ] chan:join 时验证 access_token
- [ ] access_token 事件刷新 token

#### 6.2 SDK 认证
- [ ] accessToken 回调支持
- [ ] setAuth() 方法
- [ ] 心跳时自动刷新 token

#### 6.3 错误处理
- [ ] Server: 完整错误码返回
- [ ] SDK: 错误回调和处理
- [ ] WebSocket 关闭码处理

#### 6.4 限制实现
- [ ] 消息大小限制 (100KB)
- [ ] 速率限制 (基础实现)

**产出**: 安全的认证机制和完善的错误处理

---

### 迭代 7: 重连与容错

**目标**: 实现客户端自动重连和消息缓冲

#### 7.1 SDK 重连
- [ ] 指数退避重连策略
- [ ] 重连后自动重新加入频道
- [ ] 重连后重新 track presence

#### 7.2 消息缓冲
- [ ] Client sendBuffer (断线时缓存)
- [ ] Channel pushBuffer (未 joined 时缓存)
- [ ] 重连后自动发送缓存消息

#### 7.3 心跳优化
- [ ] 心跳超时检测
- [ ] 心跳状态回调

**产出**: 网络不稳定时客户端能自动恢复

---

### 迭代 8: REST API 与完善

**目标**: 添加 HTTP REST API，完善功能

#### 8.1 Server REST API
- [ ] `POST /api/broadcast` - HTTP 广播接口
- [ ] 认证中间件

#### 8.2 SDK HTTP 支持
- [ ] `channel.httpSend()` 方法
- [ ] fetch 配置支持

#### 8.3 完善
- [ ] 日志系统
- [ ] 类型导出完善
- [ ] 文档和示例

**产出**: 完整可用的 Realtime 消息系统

---

## 关键文件清单

### packages/shared/src/
- `constants.ts` - 所有常量和枚举
- `types.ts` - TypeScript 类型定义
- `serializer.ts` - 消息序列化
- `index.ts` - 导出

### packages/sdk/src/
- `RealtimeClient.ts` - 客户端主类
- `RealtimeChannel.ts` - 频道类
- `RealtimePresence.ts` - Presence 类
- `lib/push.ts` - 消息推送
- `lib/timer.ts` - 定时器
- `lib/websocket-factory.ts` - WebSocket 工厂
- `index.ts` - 导出

### packages/server/src/
- `index.ts` - 服务入口
- `WebSocketServer.ts` - WS 服务器
- `ChannelManager.ts` - 频道管理
- `BroadcastHandler.ts` - 广播处理
- `PresenceManager.ts` - Presence 管理
- `auth/JwtVerifier.ts` - JWT 验证
- `redis/RedisAdapter.ts` - Redis 适配器
- `redis/RedisPubSub.ts` - Pub/Sub 实现

---

## 开发顺序建议

1. **先 shared** - 定义好协议常量和类型
2. **server 和 sdk 并行** - 每个迭代两边同步开发
3. **先核心后扩展** - 连接 → 频道 → 广播 → Presence → Redis
4. **每迭代写测试** - 保证功能可用

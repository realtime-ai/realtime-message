# Realtime Message

实时消息系统，包含 WebSocket SDK 和 Server。

## 项目结构

```
packages/
├── shared/     # 共享类型、常量、序列化工具
├── sdk/        # 客户端 SDK (RealtimeClient, RealtimeChannel, RealtimePresence)
├── server/     # Node.js 服务端 (Hono + ws)
└── workers/    # Cloudflare Workers 部署 (Durable Objects)
```

## 常用命令

```bash
npm run build          # 构建所有包 (shared 必须先构建)
npm run dev:server     # 启动开发服务器
npm run test           # 运行测试
npm run typecheck      # 类型检查
```

## 协议核心

**消息格式**: `[join_seq, seq, topic, event, payload]`

**系统事件**:
- `chan:join` / `chan:leave` - 加入/离开频道
- `chan:reply` - 响应 (status: ok/error)
- `chan:error` / `chan:close` - 错误/关闭
- `heartbeat` - 心跳 (topic: `$system`)

**业务事件**:
- `broadcast` - 广播消息
- `presence_state` / `presence_diff` - Presence 状态

## 认证

仅使用 JWT Token，通过 `accessToken` 回调或 `token` 配置。

## 关键常量

```typescript
DEFAULT_TIMEOUT = 10_000          // 10s
DEFAULT_HEARTBEAT_INTERVAL = 25_000  // 25s
MAX_MESSAGE_SIZE = 102_400        // 100KB
SYSTEM_TOPIC = '$system'
```

## 代码风格

- **注释要求**：对关键函数和关键代码必须添加详细的 JSDoc 注释
- 使用 TypeScript 严格模式
- 使用 ESM 模块 (`"type": "module"`)

```typescript
/**
 * 将 Message 对象序列化为 WebSocket 传输格式
 * 
 * @param message - 要序列化的消息对象
 * @returns JSON 字符串格式的消息数组 [join_seq, seq, topic, event, payload]
 * 
 * @example
 * ```ts
 * const encoded = encode({
 *   join_seq: '1',
 *   seq: '2',
 *   topic: 'room:123',
 *   event: 'broadcast',
 *   payload: { text: 'hello' }
 * })
 * // => '["1","2","room:123","broadcast",{"text":"hello"}]'
 * ```
 */
export function encode(message: Message): string {
  // 转换为数组格式以减少传输大小
  const raw: RawMessage = [
    message.join_seq,
    message.seq,
    message.topic,
    message.event,
    message.payload,
  ]
  return JSON.stringify(raw)
}
```

## 注意事项

- 修改 shared 后需要重新构建：`npm run build:shared`
- 测试前会自动构建 shared

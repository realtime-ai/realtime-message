import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',
    
    // 只运行集成测试
    include: [
      'packages/**/*.integration.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'packages/**/__integration__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    
    // 排除目录
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
    
    // 全局设置
    globals: true,
    
    // 集成测试需要更长的超时时间
    testTimeout: 30000,
    hookTimeout: 30000,
    
    // 顺序运行，避免资源冲突
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    
    // 集成测试失败时重试
    retry: 1,
  },
})


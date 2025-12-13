import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',
    
    // 测试文件匹配模式
    include: [
      'packages/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'packages/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
    ],
    
    // 排除目录
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/examples/**',
    ],
    
    // 全局设置
    globals: true,
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/__tests__/**',
        'packages/*/src/**/index.ts',
      ],
    },
    
    // 超时设置
    testTimeout: 10000,
    hookTimeout: 10000,
    
    // 并行运行
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
})


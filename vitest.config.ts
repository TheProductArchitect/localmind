import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Path alias goes at top-level `resolve.alias` so both Vite (dev server)
  // and Vitest pick it up. `test.alias` works in Vitest only and trips up
  // any plugin / source map step that reads the Vite resolver.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts']
  }
})
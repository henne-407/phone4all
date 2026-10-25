import { defineConfig } from 'vitest/config'

// Nur die reine Logik (ohne React Native) wird mit Vitest geprüft
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})

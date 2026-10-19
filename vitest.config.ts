import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Feste Zeitzone, damit Kalendertests (Sommerzeit) überall gleich laufen
    env: { TZ: 'Europe/Berlin' },
  },
})

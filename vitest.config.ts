import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    environment: 'node',
    // Feste Zeitzone mit Sommerzeit, damit Datumsrechnung über die Umstellung geprüft wird
    env: { TZ: 'Europe/Berlin' },
  },
})

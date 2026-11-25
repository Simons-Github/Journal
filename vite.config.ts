import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Lokal läuft die API separat (npm run dev:api); auf Vercel liegt sie unter /api im selben Projekt
    proxy: { '/api': 'http://localhost:3001' },
  },
})

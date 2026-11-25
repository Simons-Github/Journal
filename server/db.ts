import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'

function createClient() {
  const connectionString = process.env.DATABASE_URL
  // connection_limit aus der URL gilt weiter als Poolgröße (der lokale Prisma-Postgres verträgt nur eine Verbindung)
  let max: number | undefined
  try { max = Number(new URL(connectionString ?? '').searchParams.get('connection_limit')) || undefined } catch { /* keine gültige URL */ }
  // Wie in Prisma 6: nach 5 s Verbindungsaufbau abbrechen statt endlos zu warten
  const adapter = new PrismaPg({ connectionString, max, connectionTimeoutMillis: 5_000 })
  return new PrismaClient({ adapter, log: ['error'] })
}

// In Serverless-Umgebungen (Vercel) und bei Hot-Reload nur eine Instanz pro Prozess
const g = globalThis as unknown as { __prisma?: PrismaClient }

export const prisma = g.__prisma ?? createClient()
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma

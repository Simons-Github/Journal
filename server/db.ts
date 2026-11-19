import prismaPkg from '@prisma/client'

const { PrismaClient } = prismaPkg

// In Serverless-Umgebungen (Vercel) und bei Hot-Reload nur eine Instanz pro Prozess
const g = globalThis as unknown as { __prisma?: InstanceType<typeof PrismaClient> }

export const prisma = g.__prisma ?? new PrismaClient({ log: ['error'] })
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma

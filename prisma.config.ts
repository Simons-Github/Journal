import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrationen über die direkte Verbindung (Neon: ohne Pooler); `prisma generate` braucht keine
  datasource: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL },
})

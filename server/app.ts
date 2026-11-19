import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { ZodError } from 'zod'
import { authRouter, secret } from './auth.js'
import { workspaceRouter } from './workspace.js'
import { HttpError } from './http.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '4.5mb' }))
app.use(cookieParser())

// Grundlegende Security-Header für alle API-Antworten
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// Schutz gegen CSRF: schreibende Requests nur als JSON (erzwingt CORS-Preflight bei fremden Seiten)
app.use((req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
    return next(new HttpError(415, 'Nur JSON-Anfragen werden akzeptiert'))
  }
  next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))
// Ohne gültiges JWT_SECRET gar nicht erst loslegen (sonst z. B. Konto angelegt, aber kein Login möglich)
app.use('/api', (_req, _res, next) => { try { secret(); next() } catch (e) { next(e) } })
app.use('/api/auth', authRouter)
app.use('/api/workspace', workspaceRouter)

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route nicht gefunden')))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(err.errors[0]?.code === 'custom' ? 422 : 400).json({ error: err.errors[0]?.message || 'Ungültige Eingabe' })
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.body })
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Anfrage ist zu groß' })
  }
  console.error(err)
  res.status(500).json({ error: 'Interner Serverfehler' })
})

export default app

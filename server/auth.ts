import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { HttpError, clientIp, handler, isSecure } from './http.js'

const COOKIE = 'wm_session'
const SESSION_DAYS = 30
/** Session wird verlängert, wenn sie älter als ein Tag ist (gleitendes Ablaufdatum) */
const REFRESH_AFTER_S = 24 * 3600

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { userId?: string } }
}

export function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new HttpError(500, 'Server nicht konfiguriert: JWT_SECRET fehlt oder ist kürzer als 32 Zeichen')
  return s
}

function setSession(req: Request, res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, secret(), { expiresIn: `${SESSION_DAYS}d` })
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  })
}

function clearSession(req: Request, res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: isSecure(req), sameSite: 'lax', path: '/' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE]
  if (!token) return next(new HttpError(401, 'Nicht angemeldet'))
  try {
    const payload = jwt.verify(token, secret()) as jwt.JwtPayload
    req.userId = String(payload.sub)
    if (payload.iat && Date.now() / 1000 - payload.iat > REFRESH_AFTER_S) setSession(req, res, req.userId)
    next()
  } catch (e) {
    if (e instanceof HttpError) return next(e)
    clearSession(req, res)
    next(new HttpError(401, 'Sitzung abgelaufen – bitte erneut anmelden'))
  }
}

// ---------- Begrenzung von Fehlversuchen ----------
async function tooMany(key: string, max: number, windowMin: number) {
  const since = new Date(Date.now() - windowMin * 60_000)
  return (await prisma.authAttempt.count({ where: { key, createdAt: { gt: since } } })) >= max
}
async function recordAttempt(...keys: string[]) {
  await prisma.authAttempt.createMany({ data: keys.map(key => ({ key })) })
  if (Math.random() < 0.05) {
    await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } })
  }
}

// ---------- Routen ----------
const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(1, 'Passwort fehlt').max(200),
})
const newPassword = z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen haben').max(200)

export const authRouter = Router()

authRouter.post('/register', handler(async (req, res) => {
  const { email } = credentials.parse(req.body)
  const password = newPassword.parse(req.body.password)
  const ipKey = `register:${clientIp(req)}`
  if (await tooMany(ipKey, 10, 60)) throw new HttpError(429, 'Zu viele Registrierungen – bitte später erneut versuchen')
  await recordAttempt(ipKey)

  if (await prisma.user.findUnique({ where: { email } })) {
    throw new HttpError(409, 'Für diese E-Mail gibt es bereits ein Konto')
  }
  const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12) } })
  setSession(req, res, user.id)
  res.status(201).json({ email: user.email })
}))

authRouter.post('/login', handler(async (req, res) => {
  const { email, password } = credentials.parse(req.body)
  const emailKey = `login:${email}`
  const ipKey = `login-ip:${clientIp(req)}`
  if (await tooMany(emailKey, 10, 15) || await tooMany(ipKey, 50, 15)) {
    throw new HttpError(429, 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen')
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await recordAttempt(emailKey, ipKey)
    throw new HttpError(401, 'E-Mail oder Passwort ist falsch')
  }
  await prisma.authAttempt.deleteMany({ where: { key: emailKey } })
  setSession(req, res, user.id)
  res.json({ email: user.email })
}))

authRouter.post('/logout', (req, res) => {
  clearSession(req, res)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, handler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user) { clearSession(req, res); throw new HttpError(401, 'Konto existiert nicht mehr') }
  res.json({ email: user.email })
}))

authRouter.post('/password', requireAuth, handler(async (req, res) => {
  const current = z.string().min(1).parse(req.body.current)
  const next = newPassword.parse(req.body.next)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } })
  if (!(await bcrypt.compare(current, user.passwordHash))) throw new HttpError(403, 'Aktuelles Passwort ist falsch')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } })
  res.json({ ok: true })
}))

authRouter.delete('/account', requireAuth, handler(async (req, res) => {
  const password = z.string().min(1).parse(req.body.password)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } })
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(403, 'Passwort ist falsch')
  await prisma.user.delete({ where: { id: user.id } }) // Workspace + Versionen per Cascade
  clearSession(req, res)
  res.json({ ok: true })
}))

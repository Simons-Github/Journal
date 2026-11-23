import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import { HttpError } from '../http.js'

/**
 * API-Keys der Nutzer: Jeder hinterlegt seine eigenen Keys, die Kosten trägt sein eigenes Konto.
 * Gespeichert wird verschlüsselt (AES-256-GCM); der Browser bekommt nie den Key zurück, nur die letzten vier Zeichen.
 * Server-Keys aus den Umgebungsvariablen gelten nur für Adressen in AI_SERVER_KEY_EMAILS (z. B. der Betreiber selbst).
 */

export const PROVIDERS = ['anthropic', 'gemini', 'youtube'] as const
export type Provider = (typeof PROVIDERS)[number]
export type Keys = Partial<Record<Provider, string>>

const ENV: Record<Provider, string> = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', youtube: 'YOUTUBE_API_KEY' }

// ---------- Verschlüsselung ----------
function masterKey(): Buffer {
  const own = process.env.AI_KEYS_SECRET
  if (own && own.length >= 32) return crypto.createHash('sha256').update(own).digest()
  const jwt = process.env.JWT_SECRET
  if (!jwt || jwt.length < 32) throw new HttpError(500, 'Server nicht konfiguriert: AI_KEYS_SECRET oder JWT_SECRET fehlt')
  // Ohne eigenes Geheimnis aus JWT_SECRET abgeleitet (eigener Zweck, damit nicht derselbe Schlüssel)
  return Buffer.from(crypto.hkdfSync('sha256', jwt, 'journal', 'user-api-keys-v1', 32))
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decrypt(stored: string): string {
  const [v, iv, tag, data] = stored.split(':')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('unbekanntes Format')
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}

// ---------- Welche Keys gelten für einen Nutzer ----------
function serverKeyAllowed(email: string): boolean {
  const list = (process.env.AI_SERVER_KEY_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return list.includes(email.toLowerCase())
}

/** Eigene Keys des Nutzers; fehlende nur für freigeschaltete Adressen aus den Server-Keys ergänzt */
export async function keysFor(userId: string): Promise<{ keys: Keys; source: Partial<Record<Provider, 'own' | 'server'>> }> {
  const [rows, user] = await Promise.all([
    prisma.userApiKey.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ])
  const keys: Keys = {}
  const source: Partial<Record<Provider, 'own' | 'server'>> = {}
  for (const r of rows) {
    try { keys[r.provider as Provider] = decrypt(r.secret); source[r.provider as Provider] = 'own' } catch { /* z. B. Geheimnis geändert: Key gilt als nicht hinterlegt */ }
  }
  if (user && serverKeyAllowed(user.email)) {
    for (const p of PROVIDERS) {
      const env = process.env[ENV[p]]
      if (!keys[p] && env) { keys[p] = env; source[p] = 'server' }
    }
  }
  return { keys, source }
}

export function requireKey(keys: Keys, p: Provider): string {
  const k = keys[p]
  if (k) return k
  throw new HttpError(412, p === 'anthropic'
    ? 'Hinterlege zuerst deinen Anthropic-API-Key in den Einstellungen'
    : p === 'gemini' ? 'Für YouTube-Videos hinterlege deinen Gemini-API-Key in den Einstellungen'
      : 'Für YouTube-Playlists hinterlege deinen YouTube-API-Key in den Einstellungen')
}

// ---------- Prüfen beim Speichern (ein günstiger Aufruf je Anbieter) ----------
export async function verifyKey(p: Provider, key: string): Promise<void> {
  if (p === 'anthropic') {
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 })
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(400, 'Anthropic lehnt diesen Key ab – bitte prüfen')
      throw new HttpError(502, 'Anthropic ist gerade nicht erreichbar – bitte später erneut versuchen')
    }
    return
  }
  const url = p === 'gemini'
    ? `${process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'}/models?pageSize=1`
    : `${process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3'}/videos?part=id&id=jNQXAC9IVRw`
  let res: Response
  try { res = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) }) } catch {
    throw new HttpError(502, 'Google ist gerade nicht erreichbar – bitte später erneut versuchen')
  }
  if (res.ok) return
  if (res.status === 403 && p === 'youtube') throw new HttpError(400, 'Für diesen Key ist die YouTube Data API v3 nicht aktiviert (Google Cloud Console → APIs)')
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new HttpError(400, 'Google lehnt diesen Key ab – bitte prüfen')
  throw new HttpError(502, `Google antwortet mit Fehler ${res.status}`)
}

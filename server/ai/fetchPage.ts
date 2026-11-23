import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { HttpError } from '../http.js'

/**
 * Lädt öffentliche Kursseiten (z. B. MIT OpenCourseWare) als Text.
 * Der Server ruft hier Adressen auf, die Nutzer eingeben – deshalb streng: nur https auf Port 443,
 * keine privaten oder lokalen IP-Adressen (geprüft bei jeder Verbindung, auch nach Weiterleitungen),
 * höchstens 2 MB pro Seite, 15 Sekunden Zeit und nur HTML oder Text.
 */

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') ||
    v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

/** DNS-Auflösung, die private Ziele ablehnt; wird direkt beim Verbinden benutzt (kein Umweg über DNS-Rebinding) */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error) => void)(err)
    const list = addresses as dns.LookupAddress[]
    const ok = list.filter(a => !isPrivateIp(a.address))
    if (!ok.length || ok.length !== list.length) {
      return (callback as (e: Error) => void)(new HttpError(400, 'Diese Adresse ist nicht öffentlich erreichbar'))
    }
    if ((options as dns.LookupOptions).all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, ok)
    ;(callback as (e: null, a: string, f: number) => void)(null, ok[0].address, ok[0].family)
  })
}

export function checkUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new HttpError(400, 'Das ist keine gültige Adresse') }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Nur https-Adressen werden unterstützt')
  if (url.port && url.port !== '443') throw new HttpError(400, 'Diese Adresse ist nicht erlaubt')
  if (url.username || url.password) throw new HttpError(400, 'Diese Adresse ist nicht erlaubt')
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new HttpError(400, 'Diese Adresse ist nicht öffentlich erreichbar')
  }
  url.hash = ''
  return url
}

function getOnce(url: URL, signal?: AbortSignal): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      signal,
      headers: { 'User-Agent': 'JournalCourseImport/1.0', Accept: 'text/html,text/plain;q=0.9' },
    }, res => {
      const status = res.statusCode ?? 0
      const type = String(res.headers['content-type'] ?? '')
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location: res.headers.location, type, body: '' }) }
      if (status !== 200) { res.resume(); return reject(new HttpError(502, `Die Seite antwortet mit Fehler ${status}`)) }
      if (!/text\/html|text\/plain|application\/xhtml/.test(type)) { res.resume(); return reject(new HttpError(415, 'Die Adresse liefert keine Webseite (z. B. eine PDF) – lade die Datei stattdessen herunter und hier hoch')) }
      let size = 0
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BYTES) { req.destroy(new HttpError(413, 'Die Seite ist zu groß')); return }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status, type, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new HttpError(504, 'Die Seite antwortet nicht')))
    req.on('error', e => reject(e instanceof HttpError ? e : new HttpError(502, 'Die Seite konnte nicht geladen werden')))
  })
}

/** Holt eine Seite; folgt bis zu drei Weiterleitungen, jede wird erneut geprüft */
export async function fetchPage(raw: string, signal?: AbortSignal): Promise<{ url: string; html: string }> {
  let url = checkUrl(raw)
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await getOnce(url, signal)
    if (r.location) { url = checkUrl(new URL(r.location, url).toString()); continue }
    return { url: url.toString(), html: r.body }
  }
  throw new HttpError(502, 'Zu viele Weiterleitungen')
}

// ---------- HTML → Text ----------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '' }
  return ENTITIES[e.toLowerCase()] ?? m
})

export function pageTitle(html: string): string {
  return decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

/** Lesbarer Text einer Seite: Hauptinhalt ohne Menüs und Skripte, Tabellenzeilen als „a | b | c“ */
export function htmlToText(html: string): string {
  let h = html
  const main = /<main[\s>][\s\S]*<\/main>/i.exec(h)?.[0] ?? /<article[\s>][\s\S]*<\/article>/i.exec(h)?.[0]
  if (main && main.length > 500) h = main
  h = h.replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|form|button|select)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<\/(tr|p|li|h[1-6]|div|section|table|ul|ol|dt|dd|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
  return decode(h)
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').replace(/^\s*\|\s*/, '').replace(/(\s*\|\s*)+$/, '').trim())
    .filter(l => l && l !== '-' && l !== '|')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Links auf Unterseiten, die für einen Kursplan typisch sind (gleiche Website, unterhalb der Kursadresse) */
const COURSE_PAGE = /syllabus|calendar|schedule|assignments?|problem-?sets?|readings?|lecture-?notes|lectures|exams?|quizzes|recitations?|lehrplan|termine|zeitplan|aufgaben|uebungen|übungen/i

export function coursePageLinks(html: string, base: string, max = 6): string[] {
  const root = new URL(base)
  const prefix = root.pathname.replace(/\/pages\/.*$/, '/').replace(/[^/]*$/, '')
  const out: string[] = []
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL
    try { u = new URL(decode(m[1]), root) } catch { continue }
    if (u.origin !== root.origin || !u.pathname.startsWith(prefix) || u.pathname === root.pathname) continue
    const label = htmlToText(m[2])
    if (!COURSE_PAGE.test(u.pathname) && !COURSE_PAGE.test(label)) continue
    if (/\.(pdf|zip|jpg|png|mp4)$/i.test(u.pathname)) continue
    u.search = ''; u.hash = ''
    const s = u.toString()
    if (!out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Kursseite und ihre wichtigsten Unterseiten als ein Text, Seiten mit Überschrift getrennt */
export async function fetchCoursePages(raw: string, maxChars: number, signal?: AbortSignal) {
  const first = await fetchPage(raw, signal)
  const pages = [{ url: first.url, title: pageTitle(first.html), text: htmlToText(first.html) }]
  for (const link of coursePageLinks(first.html, first.url)) {
    if (pages.reduce((n, p) => n + p.text.length, 0) > maxChars) break
    try {
      const p = await fetchPage(link, signal)
      pages.push({ url: p.url, title: pageTitle(p.html), text: htmlToText(p.html) })
    } catch { /* einzelne Unterseite darf fehlen */ }
  }
  const text = pages.map(p => `=== ${p.title || p.url} (${p.url}) ===\n${p.text}`).join('\n\n').slice(0, maxChars)
  return { text, pages: pages.map(p => ({ url: p.url, title: p.title, chars: p.text.length })) }
}

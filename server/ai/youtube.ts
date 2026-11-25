import { HttpError } from '../http.js'

/**
 * YouTube: Adressen erkennen und Playlists über die YouTube Data API v3 als Text lesen
 * (Titel, Beschreibung, Länge jedes Videos). Ein Kurs als Playlist braucht so kein Video-Modell –
 * die Struktur steckt in den Titeln und lässt sich wörtlich prüfen.
 */

export type YouTubeRef = { kind: 'video'; id: string; url: string } | { kind: 'playlist'; id: string; url: string }

const ID = /^[A-Za-z0-9_-]{11}$/
const LIST = /^[A-Za-z0-9_-]{10,64}$/

export function parseYouTube(raw: string): YouTubeRef | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '')
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return null
  const list = u.searchParams.get('list')
  // Ein Video aus einer Playlist: die ganze Playlist ist meist der Kurs
  if (list && LIST.test(list)) return { kind: 'playlist', id: list, url: `https://www.youtube.com/playlist?list=${list}` }
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1)
  else if (u.pathname === '/watch') id = u.searchParams.get('v')
  else id = /^\/(?:shorts|live|embed|v)\/([^/?]+)/.exec(u.pathname)?.[1] ?? null
  return id && ID.test(id) ? { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` } : null
}

const apiBase = () => process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3'

async function api<T>(key: string, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams(params)
  let res: Response
  // Key im Header statt in der Adresse, damit er nicht in Logs von Zwischenstationen landet
  try { res = await fetch(`${apiBase()}/${path}?${q}`, { signal, headers: { 'x-goog-api-key': key } }) } catch { throw new HttpError(502, 'YouTube ist nicht erreichbar') }
  if (res.status === 404) throw new HttpError(404, 'Diese Playlist oder dieses Video gibt es nicht (oder es ist privat)')
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new HttpError(400, 'Dein YouTube-API-Key wurde abgelehnt – bitte in den Einstellungen prüfen')
  if (!res.ok) throw new HttpError(502, `YouTube antwortet mit Fehler ${res.status}`)
  return res.json() as Promise<T>
}

/** ISO-8601-Dauer (PT1H2M3S) in Sekunden */
export function isoSeconds(d: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d)
  if (!m) return 0
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0)
}
export const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

interface VideoItem { id: string; contentDetails?: { duration?: string }; snippet?: { title?: string; channelTitle?: string; description?: string } }

/** Länge und Titel eines Videos (für die Kostenschätzung vor der Analyse) */
export async function videoInfo(key: string | undefined, id: string, signal?: AbortSignal): Promise<{ title: string; seconds: number } | null> {
  if (!key) return null
  const r = await api<{ items: VideoItem[] }>(key, 'videos', { part: 'snippet,contentDetails', id }, signal)
  const v = r.items?.[0]
  if (!v) throw new HttpError(404, 'Dieses Video gibt es nicht (oder es ist privat)')
  return { title: v.snippet?.title ?? '', seconds: isoSeconds(v.contentDetails?.duration ?? '') }
}

const MAX_VIDEOS = 300

/** Playlist als Kursmaterial: eine Zeile je Video mit Länge, darunter der Anfang der Beschreibung */
export async function playlistText(key: string, id: string, maxChars: number, signal?: AbortSignal) {
  const meta = await api<{ items: { snippet: { title: string; channelTitle: string; description: string } }[] }>(key, 'playlists', { part: 'snippet', id }, signal)
  const pl = meta.items?.[0]?.snippet
  if (!pl) throw new HttpError(404, 'Diese Playlist gibt es nicht (oder sie ist privat)')

  const entries: { videoId: string; title: string; description: string }[] = []
  let pageToken = ''
  do {
    const page = await api<{ nextPageToken?: string; items: { snippet: { title: string; description: string; resourceId: { videoId: string } } }[] }>(
      key, 'playlistItems', { part: 'snippet', playlistId: id, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, signal)
    for (const it of page.items ?? []) {
      if (it.snippet.title === 'Private video' || it.snippet.title === 'Deleted video') continue
      entries.push({ videoId: it.snippet.resourceId.videoId, title: it.snippet.title, description: it.snippet.description ?? '' })
    }
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && entries.length < MAX_VIDEOS)

  const seconds = new Map<string, number>()
  for (let i = 0; i < entries.length; i += 50) {
    const r = await api<{ items: VideoItem[] }>(key, 'videos', { part: 'contentDetails', id: entries.slice(i, i + 50).map(e => e.videoId).join(',') }, signal)
    for (const v of r.items ?? []) seconds.set(v.id, isoSeconds(v.contentDetails?.duration ?? ''))
  }

  const total = entries.reduce((s, e) => s + (seconds.get(e.videoId) ?? 0), 0)
  const head = [
    `YouTube playlist: ${pl.title}`,
    `Channel: ${pl.channelTitle}`,
    `${entries.length} videos, ${fmtDuration(total)} in total`,
    pl.description ? `\nPlaylist description:\n${pl.description.slice(0, 2000)}` : '',
    '\nVideos in order:',
  ].filter(Boolean).join('\n')
  const lines = entries.map((e, i) => {
    const s = seconds.get(e.videoId)
    const desc = e.description.replace(/\s+/g, ' ').trim().slice(0, 300)
    return `${i + 1}. ${e.title}${s ? ` (${fmtDuration(s)})` : ''}${desc ? `\n   ${desc}` : ''}`
  })
  return {
    text: `${head}\n${lines.join('\n')}`.slice(0, maxChars),
    // Bei Playlists steht in `chars` die Zahl der Videos
    pages: [{ url: `https://www.youtube.com/playlist?list=${id}`, title: pl.title, chars: entries.length }],
  }
}

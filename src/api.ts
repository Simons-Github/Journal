/** API läuft im selben Vercel-Projekt unter /api (lokal per Vite-Proxy) */
export const API_URL: string = import.meta.env.VITE_API_URL || '/api'

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message) }
}

export interface RemoteWorkspace { data: Record<string, unknown>; version: number; updatedAt: string }
export interface VersionInfo { id: string; version: number; reason: string; createdAt: string; bytes: number; tasks: number; notes: number }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError('Server nicht erreichbar', 0)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(body?.error || `Fehler ${res.status}`, res.status, body ?? undefined)
  return body as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const api = {
  me: () => request<{ email: string }>('/auth/me'),
  login: (email: string, password: string) => request<{ email: string }>('/auth/login', json('POST', { email, password })),
  register: (email: string, password: string) => request<{ email: string }>('/auth/register', json('POST', { email, password })),
  logout: () => request<{ ok: true }>('/auth/logout', json('POST', {})),
  changePassword: (current: string, next: string) => request<{ ok: true }>('/auth/password', json('POST', { current, next })),
  deleteAccount: (password: string) => request<{ ok: true }>('/auth/account', json('DELETE', { password })),

  getWorkspace: () => request<RemoteWorkspace | null>('/workspace'),
  putWorkspace: (data: unknown, baseVersion: number, opts: { force?: boolean; snapshot?: string } = {}) =>
    request<RemoteWorkspace>('/workspace', json('PUT', { data, baseVersion, ...opts })),
  versions: () => request<VersionInfo[]>('/workspace/versions'),
  restore: (id: string) => request<RemoteWorkspace>('/workspace/restore', json('POST', { id })),

  aiStatus: () => request<AiStatus>('/ai/status'),
  aiChat,

  /** Beim Schließen des Tabs: Request überlebt das Entladen der Seite (max. 64 KB) */
  putKeepalive: (data: unknown, baseVersion: number) => {
    const body = JSON.stringify({ data, baseVersion })
    if (body.length > 60000) return
    fetch(API_URL + '/workspace', {
      method: 'PUT', keepalive: true, credentials: 'include', body,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
  },
}

// ---------- KI-Assistent ----------
export interface AiStatus { enabled: boolean; model: string; usedUsd: number; budgetUsd: number }
/** Nachricht im Format der Claude-API; der Browser speichert sie nur und schickt sie unverändert zurück */
export interface AiMessage { role: 'user' | 'assistant'; content: string | Record<string, unknown>[] }
export interface AiSource { kind: 'note' | 'book' | 'fog' | 'task' | 'project'; id: string; title: string }
export interface AiProposal {
  id: string
  project: { id: string; name: string } | { newName: string } | null
  tasks: { title: string; due?: string; priority: '' | 'Hoch' | 'Mittel' | 'Gering' }[]
}
export type AiEvent =
  | { t: 'text'; v: string }
  | { t: 'tool'; name: string; input: Record<string, unknown> }
  | { t: 'sources'; items: AiSource[] }
  | { t: 'proposal'; proposal: AiProposal }
  | { t: 'done'; messages: AiMessage[]; stop: string | null }
  | { t: 'error'; error: string }

/** Schickt eine Nachricht an den Assistenten; die Antwort kommt Zeile für Zeile als Ereignis */
async function aiChat(
  body: { history: AiMessage[]; text: string; lang: string; today: string },
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(API_URL + '/ai/chat', {
      method: 'POST', credentials: 'include', signal, body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError('Server nicht erreichbar', 0)
  }
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null)
    throw new ApiError(err?.error || `Fehler ${res.status}`, res.status, err ?? undefined)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    buf += decoder.decode(value, { stream: !done })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as AiEvent)
    }
    if (done) break
  }
}

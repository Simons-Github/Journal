import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ApiError, RemoteWorkspace, api } from './api'
import { DB, useStore } from './store'
import { t } from './i18n'

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict'

/** Die eigentliche Sitzung steckt im httpOnly-Cookie; hier merken wir uns nur, wer angemeldet war */
interface Auth { email: string }
interface Meta { version: number; dirty: boolean }

const AUTH_KEY = '12wm-auth'
const META_KEY = '12wm-sync'
const DEBOUNCE_MS = 1200

function read<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}
function write(key: string, v: unknown) {
  try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

type SyncCtx = {
  auth: Auth | null
  status: SyncStatus
  message: string
  lastSynced: string | null
  conflict: RemoteWorkspace | null
  login: (email: string, password: string, mode: 'login' | 'register') => Promise<void>
  logout: () => Promise<void>
  /** Abgemeldet, weil das Konto gelöscht wurde: lokalen Sync-Zustand zurücksetzen */
  forgetAccount: () => void
  syncNow: () => void
  resolveConflict: (keep: 'server' | 'local') => void
  /** Vor der nächsten Speicherung den bisherigen Server-Stand als Sicherung ablegen */
  markSnapshot: (reason: string) => void
  restore: (id: string) => Promise<void>
}

const Ctx = createContext<SyncCtx | null>(null)
export const useSync = () => useContext(Ctx)!

export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, replace } = useStore()
  const [auth, setAuth] = useState<Auth | null>(() => read<Auth | null>(AUTH_KEY, null))
  const [status, setStatus] = useState<SyncStatus>(auth ? 'syncing' : 'local')
  const [message, setMessage] = useState('')
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [conflict, setConflict] = useState<RemoteWorkspace | null>(null)

  const meta = useRef<Meta>(read<Meta>(META_KEY, { version: 0, dirty: false }))
  const dbRef = useRef(db)
  const applyingRemote = useRef(false)
  const lastDb = useRef(db)
  const timer = useRef<number>()
  const inflight = useRef(false)
  const snapshotNext = useRef<string | undefined>()
  const replaceRef = useRef(replace)
  dbRef.current = db
  replaceRef.current = replace

  const saveMeta = (m: Partial<Meta>) => { meta.current = { ...meta.current, ...m }; write(META_KEY, meta.current) }

  const forget = useCallback(() => {
    window.clearTimeout(timer.current)
    write(AUTH_KEY, null); write(META_KEY, null)
    meta.current = { version: 0, dirty: false }
    setAuth(null); setStatus('local'); setConflict(null)
  }, [])

  const applyRemote = useCallback((w: RemoteWorkspace) => {
    applyingRemote.current = true
    replaceRef.current(w.data as Partial<DB>)
    saveMeta({ version: w.version, dirty: false })
    setLastSynced(w.updatedAt)
    setStatus('synced')
  }, [])

  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      forget()
      setMessage('Sitzung abgelaufen – bitte erneut anmelden. Deine Daten in diesem Browser bleiben erhalten.')
    } else if (e instanceof ApiError && e.status === 0) {
      setStatus('offline'); setMessage('Server nicht erreichbar – Änderungen werden lokal gespeichert.')
    } else {
      setStatus('error'); setMessage(e instanceof Error ? e.message : 'Unbekannter Fehler')
    }
  }, [forget])

  const showConflict = (remote: RemoteWorkspace) => {
    setConflict(remote); setStatus('conflict')
    setMessage('Der Workspace wurde auf einem anderen Gerät geändert.')
  }

  const push = useCallback(async (force = false) => {
    if (inflight.current) return
    inflight.current = true
    setStatus('syncing')
    try {
      const w = await api.putWorkspace(dbRef.current, meta.current.version, { force, snapshot: snapshotNext.current })
      snapshotNext.current = undefined
      saveMeta({ version: w.version, dirty: false })
      setLastSynced(w.updatedAt); setStatus('synced'); setMessage('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) showConflict(e.body?.workspace as RemoteWorkspace)
      else handleError(e)
    } finally {
      inflight.current = false
    }
  }, [handleError])

  /** Server-Stand abgleichen: neuer Server-Stand wird übernommen, lokale Änderungen hochgeladen */
  const pull = useCallback(async () => {
    if (inflight.current) return
    setStatus('syncing')
    try {
      const remote = await api.getWorkspace()
      const { version, dirty } = meta.current
      if (!remote) return void push()
      if (JSON.stringify(remote.data) === JSON.stringify(dbRef.current)) {
        // Inhalt identisch (z. B. Keepalive beim Schließen kam an) → nur Version übernehmen
        saveMeta({ version: remote.version, dirty: false })
        setLastSynced(remote.updatedAt); setStatus('synced'); setMessage('')
      } else if (remote.version === version) {
        if (dirty) return void push()
        setLastSynced(remote.updatedAt); setStatus('synced'); setMessage('')
      } else if (!dirty) {
        applyRemote(remote)
      } else {
        showConflict(remote)
      }
    } catch (e) { handleError(e) }
  }, [applyRemote, handleError, push])

  // Jede lokale Änderung → als „dirty“ markieren und verzögert hochladen
  useEffect(() => {
    if (db === lastDb.current) return // z. B. doppelter Effekt-Lauf im StrictMode
    lastDb.current = db
    if (applyingRemote.current) { applyingRemote.current = false; return }
    if (!auth) return
    saveMeta({ dirty: true })
    if (status === 'conflict') return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => push(), DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])

  // Beim Start, bei Fokus und wenn das Netz zurückkommt abgleichen
  useEffect(() => {
    if (!auth) return
    pull()
    const onFocus = () => { if (!meta.current.dirty) pull() }
    const onOnline = () => pull()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    const retry = window.setInterval(() => { if (meta.current.dirty) pull() }, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.clearInterval(retry)
    }
  }, [auth, pull])

  // Ungespeicherte Änderungen beim Schließen noch senden (best effort)
  useEffect(() => {
    const h = () => { if (auth && meta.current.dirty) api.putKeepalive(dbRef.current, meta.current.version) }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [auth])

  const value: SyncCtx = {
    auth, status, message, lastSynced, conflict,
    login: async (email, password, mode) => {
      const res = mode === 'login' ? await api.login(email, password) : await api.register(email, password)
      const remote = await api.getWorkspace()
      if (!remote) {
        saveMeta({ version: 0, dirty: true })
      } else if (confirm(t('In deinem Konto gibt es bereits Daten.\n\nOK = Daten aus dem Konto laden (ersetzt die lokalen Daten in diesem Browser)\nAbbrechen = lokale Daten behalten und ins Konto hochladen (der bisherige Stand im Konto wird gesichert)'))) {
        applyRemote(remote)
      } else {
        snapshotNext.current = 'Vor Upload lokaler Daten'
        saveMeta({ version: remote.version, dirty: true })
      }
      const a = { email: res.email }
      write(AUTH_KEY, a); setAuth(a); setMessage('')
    },
    logout: async () => {
      if (meta.current.dirty) await push()
      await api.logout().catch(() => {})
      forget(); setMessage('')
    },
    forgetAccount: () => { forget(); setMessage('') },
    syncNow: () => { if (auth) meta.current.dirty ? push() : pull() },
    resolveConflict: keep => {
      if (!auth || !conflict) return
      if (keep === 'server') applyRemote(conflict)
      else {
        snapshotNext.current = 'Konflikt: Stand vom anderen Gerät'
        saveMeta({ version: conflict.version }); push()
      }
      setConflict(null); setMessage('')
    },
    markSnapshot: reason => { snapshotNext.current = reason },
    restore: async id => {
      window.clearTimeout(timer.current)
      applyRemote(await api.restore(id))
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const statusLabel: Record<SyncStatus, string> = {
  local: 'Nur lokal',
  syncing: 'Synchronisiere …',
  synced: 'Synchronisiert',
  offline: 'Offline',
  error: 'Sync-Fehler',
  conflict: 'Konflikt',
}

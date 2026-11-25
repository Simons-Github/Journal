import { FormEvent, useEffect, useRef, useState } from 'react'
import { API_URL, VersionInfo, api } from '../api'
import { DB, emptyDB, useStore } from '../store'
import { statusLabel, useSync } from '../sync'
import { today } from '../utils'
import { PageHeader, Section, Tabs } from '../components/ui'
import { AiSettings } from '../components/AiSettings'
import { LANGS, locale, t, useLang } from '../i18n'
import { useTheme, ThemeMode } from '../theme'

export default function Settings() {
  const { db, replace, reset } = useStore()
  const sync = useSync()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `12-week-mastery-${today()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<DB>
      if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.habits)) {
        throw new Error(t('Das sieht nicht nach einem 12-Week-Mastery-Export aus.'))
      }
      if (!confirm(t('Import ersetzt alle aktuellen Daten. Fortfahren?'))) return
      sync.markSnapshot('Vor Import')
      replace(data)
      setImportMsg(t('„{name}“ importiert.', { name: file.name }))
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : t('Import fehlgeschlagen'))
    }
  }

  const counts = [
    ['Tasks', db.tasks.length], ['Projects', db.projects.length], ['Goals', db.goals.length],
    ['Notes', db.notes.length], ['Mornings', db.days.length], ['Evenings', db.evenings.length],
    ['Weekly Reviews', db.weeks.length], ['Books', db.books.length],
  ] as const

  return (
    <>
      <PageHeader icon="⚙️" title="Settings" />

      <Section title="Konto & Synchronisierung" icon="☁️">
        {sync.auth ? (
          <div className="settings-account">
            <p>{t('Angemeldet als')} <strong>{sync.auth.email}</strong></p>
            <p className="muted">
              Status: <span className={`sync-dot s-${sync.status}`} /> {t(statusLabel[sync.status])}
              {sync.lastSynced && <> · {t('zuletzt')} {new Date(sync.lastSynced).toLocaleString(locale())}</>}
            </p>
            {sync.message && <p className="notice">{t(sync.message)}</p>}
            <div className="toolbar">
              <button className="btn" onClick={sync.syncNow}>{t('Jetzt synchronisieren')}</button>
              <button className="btn danger" onClick={() => confirm(t('Abmelden? Die Daten bleiben in diesem Browser erhalten.')) && sync.logout()}>{t('Abmelden')}</button>
            </div>
            <AccountActions />
          </div>
        ) : <AuthForm />}
        <p className="hint small">Server: {API_URL}</p>
      </Section>

      {sync.auth && <AiSettings />}

      {sync.auth && <VersionHistory />}

      <Appearance />

      <Section title="Daten" icon="💾">
        <div className="stat-row">
          {counts.map(([l, n]) => <div key={l} className="stat"><b>{n}</b><span>{l}</span></div>)}
        </div>
        <div className="toolbar">
          <button className="btn" onClick={exportJson}>{t('Als JSON exportieren')}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{t('JSON importieren')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
        </div>
        {importMsg && <p className="notice">{importMsg}</p>}
      </Section>

      <Section title="Zurücksetzen" icon="🧹">
        <p className="hint">{t('Mit Konto wird der vorherige Stand automatisch gesichert und lässt sich unter „Sicherungen“ wiederherstellen. Ohne Konto vorher exportieren!')}</p>
        <div className="toolbar">
          <button className="btn" onClick={() => { if (confirm(t('Alle Daten durch die Beispieldaten ersetzen?'))) { sync.markSnapshot('Vor Zurücksetzen'); reset() } }}>{t('Beispieldaten laden')}</button>
          <button className="btn danger" onClick={() => {
            if (!confirm(t('Wirklich ALLE Einträge löschen? Areas, Resources und Habits bleiben erhalten.'))) return
            sync.markSnapshot('Vor Leeren')
            replace({ ...emptyDB(), name: db.name, areas: db.areas, resources: db.resources, habits: db.habits })
          }}>{t('Mit leerem Template starten')}</button>
        </div>
      </Section>
    </>
  )
}

function AuthForm() {
  const sync = useSync()
  const [mode, setMode] = useState<'Anmelden' | 'Registrieren'>('Anmelden')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await sync.login(email.trim(), password, mode === 'Anmelden' ? 'login' : 'register')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Anmeldung fehlgeschlagen'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="hint">{t('Melde dich an, um deinen Workspace auf allen Geräten zu synchronisieren. Ohne Konto bleibt alles lokal in diesem Browser.')}</p>
      {sync.message && <p className="notice">{t(sync.message)}</p>}
      <Tabs tabs={['Anmelden', 'Registrieren'] as const} value={mode} onChange={setMode} />
      <label>{t('E-Mail')}<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t('Passwort')}{mode === 'Registrieren' && ` ${t('(min. 8 Zeichen)')}`}<input type="password" required minLength={mode === 'Registrieren' ? 8 : 1}
        autoComplete={mode === 'Anmelden' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{t(error)}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '…' : t(mode)}</button>
    </form>
  )
}

function VersionHistory() {
  const sync = useSync()
  const [list, setList] = useState<VersionInfo[] | null>(null)
  const [error, setError] = useState('')
  const load = () => api.versions().then(setList).catch(e => setError(e.message))
  useEffect(() => { load() }, [sync.lastSynced])

  const restore = async (v: VersionInfo) => {
    if (!confirm(t('Stand vom {date} wiederherstellen?\n\nDer aktuelle Stand wird vorher gesichert.', { date: new Date(v.createdAt).toLocaleString(locale()) }))) return
    try { await sync.restore(v.id); await load() } catch (e) { setError(e instanceof Error ? e.message : t('Fehler')) }
  }

  return (
    <Section title="Sicherungen" icon="🕘" actions={<button className="chip" onClick={load}>{t('Aktualisieren')}</button>}>
      <p className="hint">{t('Der Server sichert deinen Workspace automatisch (höchstens alle 10 Minuten) und vor Import, Zurücksetzen, Wiederherstellen und Konflikten. Die letzten 50 Stände bleiben erhalten.')}</p>
      {error && <p className="error">{t(error)}</p>}
      {list && !list.length && <p className="muted">{t('Noch keine Sicherungen – die erste entsteht bei der nächsten Änderung nach 10 Minuten.')}</p>}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table className="db-table versions">
            <thead><tr><th>{t('Zeitpunkt')}</th><th>{t('Anlass')}</th><th>{t('Inhalt')}</th><th></th></tr></thead>
            <tbody>
              {list.map(v => (
                <tr key={v.id}>
                  <td className="nowrap">{new Date(v.createdAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{t(v.reason)}</td>
                  <td className="muted small nowrap">{v.tasks} Tasks · {t('{n} Notizen', { n: v.notes })} · {Math.max(1, Math.round(v.bytes / 1024))} KB</td>
                  <td><button className="chip" onClick={() => restore(v)}>{t('Wiederherstellen')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function AccountActions() {
  const sync = useSync()
  const [open, setOpen] = useState<'password' | 'delete' | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) { setMsg(e instanceof Error ? e.message : t('Fehler')) } finally { setBusy(false) }
  }

  return (
    <div className="account-actions">
      <div className="toolbar">
        <button className="chip" onClick={() => { setOpen(open === 'password' ? null : 'password'); setMsg('') }}>{t('Passwort ändern')}</button>
        <button className="chip" onClick={() => { setOpen(open === 'delete' ? null : 'delete'); setMsg('') }}>{t('Konto löschen')}</button>
      </div>
      {open === 'password' && (
        <form className="auth-form" onSubmit={e => { e.preventDefault(); run(async () => {
          await api.changePassword(current, next); setCurrent(''); setNext(''); setOpen(null); setMsg(t('Passwort geändert.'))
        }) }}>
          <label>{t('Aktuelles Passwort')}<input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></label>
          <label>{t('Neues Passwort (min. 8 Zeichen)')}<input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></label>
          <button className="btn primary" disabled={busy}>{t('Speichern')}</button>
        </form>
      )}
      {open === 'delete' && (
        <form className="auth-form" onSubmit={e => { e.preventDefault(); run(async () => {
          if (!confirm(t('Konto und alle Daten auf dem Server endgültig löschen? Das lässt sich nicht rückgängig machen.'))) return
          await api.deleteAccount(current); setCurrent(''); sync.forgetAccount()
        }) }}>
          <p className="hint">{t('Löscht dein Konto, den Workspace und alle Sicherungen auf dem Server. Die Daten in diesem Browser bleiben erhalten.')}</p>
          <label>{t('Passwort zur Bestätigung')}<input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></label>
          <button className="btn danger" disabled={busy}>{t('Endgültig löschen')}</button>
        </form>
      )}
      {msg && <p className="notice">{t(msg)}</p>}
    </div>
  )
}

/** Sprache und Farbmodus: gelten pro Gerät */
function Appearance() {
  const { lang, setLang } = useLang()
  const { mode, setMode } = useTheme()
  const modes: { mode: ThemeMode; label: string }[] = [
    { mode: 'light', label: 'Hell' }, { mode: 'system', label: 'Wie System' }, { mode: 'dark', label: 'Dunkel' },
  ]
  return (
    <Section title="Sprache & Darstellung" icon="🌐">
      <p className="hint">{t('Gilt nur für dieses Gerät. Deine Einträge werden nicht übersetzt.')}</p>
      <div className="prop">
        <div className="prop-label">{t('Sprache')}</div>
        <div className="prop-value">
          <div className="tabs" role="radiogroup" aria-label={t('Sprache')}>
            {LANGS.map(l => (
              <button key={l.code} role="radio" aria-checked={lang === l.code} className={lang === l.code ? 'tab active' : 'tab'} onClick={() => setLang(l.code)}>{l.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="prop">
        <div className="prop-label">{t('Farbmodus')}</div>
        <div className="prop-value">
          <div className="tabs" role="radiogroup" aria-label={t('Farbmodus')}>
            {modes.map(m => (
              <button key={m.mode} role="radio" aria-checked={mode === m.mode} className={mode === m.mode ? 'tab active' : 'tab'} onClick={() => setMode(m.mode)}>{t(m.label)}</button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}

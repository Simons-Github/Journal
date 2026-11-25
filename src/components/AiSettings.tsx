import { FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Check as CheckIcon, ExternalLink, KeyRound } from 'lucide-react'
import { AiKeys, AiProvider, ApiError, api } from '../api'
import { Section } from './ui'
import { locale, t } from '../i18n'

const PROVIDERS: { id: AiProvider; name: string; use: string; required: boolean; href: string; where: string }[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', use: 'Chat, Task-Vorschläge und Kurs-Import aus Dateien, Text und Links', required: true, href: 'https://platform.claude.com/settings/keys', where: 'Claude Console → API Keys' },
  { id: 'gemini', name: 'Google Gemini', use: 'Kurs-Import aus einzelnen YouTube-Videos', required: false, href: 'https://aistudio.google.com/apikey', where: 'Google AI Studio → API Keys' },
  { id: 'youtube', name: 'YouTube Data API', use: 'Kurs-Import aus YouTube-Playlists', required: false, href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', where: 'Google Cloud Console → YouTube Data API v3 aktivieren → Anmeldedaten' },
]

const usd = (n: number) => n.toLocaleString(locale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Einstellungen des KI-Assistenten: eigene API-Keys und eigenes Tageslimit */
export function AiSettings() {
  const [data, setData] = useState<AiKeys | null>(null)
  const [usedUsd, setUsedUsd] = useState<number | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()

  const loadUsage = () => api.aiStatus().then(s => setUsedUsd(s.usedUsd)).catch(() => {})
  useEffect(() => {
    api.aiKeys().then(setData).catch(e => setError(e instanceof ApiError ? t(e.message) : t('Unbekannter Fehler')))
    loadUsage()
  }, [])
  // Links wie „/einstellungen#ki“ aus dem Assistenten führen direkt hierher
  useEffect(() => { if (hash === '#ki' && data) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [hash, data])

  return (
    <div id="ki" ref={ref}>
      <Section title="KI-Assistent" icon="✨">
        <p className="ai-set-lead">
          {t('Der Assistent arbeitet mit deinen eigenen API-Keys – die Kosten laufen direkt über dein Konto beim jeweiligen Anbieter. Die Keys werden verschlüsselt gespeichert und nie wieder angezeigt, nur ihre letzten vier Zeichen.')}
        </p>
        {error && <div className="ai-error" role="alert">{error}</div>}
        {data && (
          <>
            <div className="ai-keys">
              {PROVIDERS.map(p => <KeyRow key={p.id} p={p} data={data} onChange={setData} />)}
            </div>
            <Budget data={data} usedUsd={usedUsd} onChange={d => { setData(d); loadUsage() }} />
          </>
        )}
      </Section>
    </div>
  )
}

function KeyRow({ p, data, onChange }: { p: (typeof PROVIDERS)[number]; data: AiKeys; onChange: (d: AiKeys) => void }) {
  const own = data.keys.find(k => k.provider === p.id)
  const server = data.serverKeys.includes(p.id)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const showForm = editing || (!own && !server)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true); setMsg(null)
    try {
      onChange(await api.aiSaveKey(p.id, value.trim()))
      setValue(''); setEditing(false); setMsg({ ok: true, text: t('Key geprüft und gespeichert.') })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? t(err.message) : t('Unbekannter Fehler') })
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!confirm(t('Key für {name} entfernen?', { name: p.name }))) return
    setBusy(true); setMsg(null)
    try { onChange(await api.aiDeleteKey(p.id)) } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? t(err.message) : t('Unbekannter Fehler') }) }
    finally { setBusy(false) }
  }

  return (
    <div className="ai-key">
      <div className="ai-key-head">
        <KeyRound size={16} strokeWidth={1.9} />
        <span className="strong">{p.name}</span>
        <span className={`pill tone-${own || server ? 'green' : p.required ? 'orange' : 'gray'}`}>
          {own ? t('Hinterlegt · …{last4}', { last4: own.last4 }) : server ? t('Server-Key freigegeben') : p.required ? t('Fehlt') : t('Optional')}
        </span>
      </div>
      <div className="muted small">{t(p.use)}</div>
      {own && !editing && (
        <div className="ai-key-actions">
          <span className="muted small">{t('Seit {date}', { date: new Date(own.updatedAt).toLocaleDateString(locale()) })}</span>
          <button className="chip" onClick={() => setEditing(true)} disabled={busy}>{t('Ersetzen')}</button>
          <button className="chip" onClick={remove} disabled={busy}>{t('Entfernen')}</button>
        </div>
      )}
      {!own && server && !editing && (
        <div className="ai-key-actions">
          <span className="muted small">{t('Du nutzt den Key dieses Servers mit. Ein eigener Key hat Vorrang.')}</span>
          <button className="chip" onClick={() => setEditing(true)}>{t('Eigenen Key hinterlegen')}</button>
        </div>
      )}
      {showForm && (
        <form className="ai-key-form" onSubmit={save}>
          <input type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={t('API-Key einfügen')} aria-label={t('API-Key für {name}', { name: p.name })} />
          <button className="btn primary" disabled={!value.trim() || busy}>{busy ? t('Prüfe …') : t('Prüfen & speichern')}</button>
          {editing && <button type="button" className="btn" onClick={() => { setEditing(false); setValue('') }}>{t('Abbrechen')}</button>}
        </form>
      )}
      {showForm && (
        <a className="ai-key-help" href={p.href} target="_blank" rel="noreferrer">
          {t('Key erstellen: {where}', { where: t(p.where) })}<ExternalLink size={12} />
        </a>
      )}
      {msg && <div className={msg.ok ? 'ai-key-ok' : 'ai-error'} role={msg.ok ? 'status' : 'alert'}>{msg.ok && <CheckIcon size={14} />}{msg.text}</div>}
    </div>
  )
}

function Budget({ data, usedUsd, onChange }: { data: AiKeys; usedUsd: number | null; onChange: (d: AiKeys) => void }) {
  const [value, setValue] = useState(data.budgetUsd === null ? '' : String(data.budgetUsd))
  const [msg, setMsg] = useState('')
  const parsed = value.trim() === '' ? null : Number(value.replace(',', '.'))
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= data.budgetRange.min && parsed <= data.budgetRange.max)
  const changed = parsed !== data.budgetUsd

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid || !changed) return
    try { onChange(await api.aiSetBudget(parsed)); setMsg(t('Gespeichert.')) } catch (err) { setMsg(err instanceof ApiError ? t(err.message) : t('Unbekannter Fehler')) }
  }

  return (
    <form className="ai-budget" onSubmit={save}>
      <label>
        <span className="strong">{t('Tageslimit')}</span>
        <span className="muted small">{t('Schutz vor versehentlich hohen Kosten auf deinem Konto. Leer lassen für den Standard ({usd}).', { usd: usd(data.defaultBudgetUsd) })}</span>
      </label>
      <div className="ai-budget-row">
        <span className="muted">$</span>
        <input inputMode="decimal" value={value} onChange={e => { setValue(e.target.value); setMsg('') }} placeholder={String(data.defaultBudgetUsd)} aria-label={t('Tageslimit in US-Dollar')} />
        <button className="btn" disabled={!valid || !changed}>{t('Speichern')}</button>
        {usedUsd !== null && <span className="muted small">{t('Heute verbraucht: {used}', { used: usd(usedUsd) })}</span>}
      </div>
      {!valid && <div className="ai-error">{t('Bitte einen Betrag zwischen {min} und {max} $ eingeben.', { min: data.budgetRange.min, max: data.budgetRange.max })}</div>}
      {msg && <div className="muted small">{msg}</div>}
    </form>
  )
}

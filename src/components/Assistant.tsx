import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUp, BookOpen, Brain, NotebookPen, Plus, Sparkles, Square, X } from 'lucide-react'
import { AiEvent, AiMessage, AiProposal, AiSource, AiStatus, ApiError, api } from '../api'
import { useSync } from '../sync'
import { useEditor } from './Editor'
import { ProposalCard, ProposalResult } from './ProposalCard'
import { t, useLang } from '../i18n'
import { today } from '../utils'

/** Was im Chat angezeigt wird; der Verlauf für die API (history) liegt getrennt daneben */
interface Item {
  role: 'user' | 'assistant'; text: string; sources?: AiSource[]; error?: string
  proposals?: AiProposal[]
  /** Was der Nutzer mit den Vorschlägen gemacht hat, nach Vorschlags-ID */
  results?: Record<string, ProposalResult>
}
interface Saved { history: AiMessage[]; items: Item[] }

const KEY = '12wm-ai-chat'
const EMPTY: Saved = { history: [], items: [] }
function load(): Saved {
  try { const r = localStorage.getItem(KEY); return r ? { ...EMPTY, ...JSON.parse(r) } : EMPTY } catch { return EMPTY }
}
function save(s: Saved | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* ignore */ }
}

const SUGGESTIONS = [
  'Was steht diese Woche an?',
  'Welche Tasks sind überfällig?',
  'Wie stehen meine Projekte und Ziele?',
  'Hilf mir, meine nächste Prüfung vorzubereiten',
]

function activity(e: Extract<AiEvent, { t: 'tool' }>): string {
  switch (e.name) {
    case 'search_notes': return t('Durchsuche Notizen nach „{q}“', { q: String(e.input.query ?? '') })
    case 'get_note': return t('Lese die Notiz')
    case 'list_tasks': return t('Schaue in deine Tasks')
    case 'list_projects': return t('Schaue in deine Projekte und Ziele')
    case 'propose_tasks': return t('Stelle Tasks zusammen')
    default: return t('Arbeite …')
  }
}

const SOURCE_ICON = { note: NotebookPen, book: BookOpen, fog: Brain, task: NotebookPen, project: NotebookPen }

function Sources({ items }: { items: AiSource[] }) {
  const ed = useEditor()
  const nav = useNavigate()
  const open = (s: AiSource) => {
    if (s.kind === 'fog') nav('/brain-fog')
    else ed.open(s.kind, s.id)
  }
  return (
    <div className="ai-sources">
      {items.map(s => {
        const Icon = SOURCE_ICON[s.kind]
        return (
          <button key={s.kind + s.id} className="ai-source" onClick={() => open(s)} title={t('Öffnen')}>
            <Icon size={13} strokeWidth={2} /><span>{s.title || t('(ohne Titel)')}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Assistant() {
  const sync = useSync()
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [chat, setChat] = useState<Saved>(load)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [doing, setDoing] = useState('')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { save(chat.items.length ? chat : null) }, [chat])
  // Abgemeldet: Chat-Verlauf (enthält Inhalte aus den Notizen) aus dem Browser löschen
  useEffect(() => { if (!sync.auth) { abort.current?.abort(); setChat(EMPTY) } }, [sync.auth])
  useEffect(() => {
    if (!open || !sync.auth) return
    api.aiStatus().then(setStatus).catch(() => setStatus(null))
    inputRef.current?.focus()
  }, [open, sync.auth])
  useEffect(() => {
    if (!open) return
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal')) setOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.items, doing, open])

  const patchLast = (fn: (it: Item) => Item) =>
    setChat(c => ({ ...c, items: c.items.map((it, i) => (i === c.items.length - 1 ? fn(it) : it)) }))

  async function send(text: string) {
    text = text.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true); setDoing(t('Denke nach …'))
    const history = chat.history
    setChat(c => ({ ...c, items: [...c.items, { role: 'user', text }, { role: 'assistant', text: '' }] }))
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      await sync.flush() // damit der Assistent den aktuellen Stand sieht
      await api.aiChat({ history, text, lang, today: today() }, e => {
        if (e.t === 'text') { setDoing(''); patchLast(it => ({ ...it, text: it.text + e.v })) }
        else if (e.t === 'tool') { setDoing(activity(e)); patchLast(it => (it.text && !it.text.endsWith('\n') ? { ...it, text: it.text + '\n\n' } : it)) }
        else if (e.t === 'sources') patchLast(it => {
          const known = new Set((it.sources ?? []).map(s => s.kind + s.id))
          return { ...it, sources: [...(it.sources ?? []), ...e.items.filter(s => !known.has(s.kind + s.id))] }
        })
        else if (e.t === 'proposal') patchLast(it => ({ ...it, proposals: [...(it.proposals ?? []), e.proposal] }))
        else if (e.t === 'done') setChat(c => ({ ...c, history: [...history, ...e.messages] }))
        else if (e.t === 'error') patchLast(it => ({ ...it, error: e.error }))
      }, ctrl.signal)
    } catch (e) {
      if (!ctrl.signal.aborted) patchLast(it => ({ ...it, error: e instanceof ApiError ? t(e.message) : t('Unbekannter Fehler') }))
    } finally {
      setBusy(false); setDoing(''); abort.current = null
      api.aiStatus().then(setStatus).catch(() => {})
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); send(input) }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) }
  }
  /** Ergebnis einer Vorschlagskarte merken und dem Modell beim nächsten Mal mitteilen */
  function resolve(index: number, p: AiProposal, r: ProposalResult) {
    const note = r.status === 'added'
      ? `[App] Der Nutzer hat ${r.count} von ${p.tasks.length} vorgeschlagenen Tasks übernommen${r.projectName ? ` (Projekt „${r.projectName}“)` : ''}.`
      : '[App] Der Nutzer hat den Task-Vorschlag verworfen.'
    setChat(c => ({
      history: [...c.history, { role: 'user', content: note }],
      items: c.items.map((it, i) => (i === index ? { ...it, results: { ...it.results, [p.id]: r } } : it)),
    }))
  }

  const reset = () => { abort.current?.abort(); setChat(EMPTY); setInput(''); inputRef.current?.focus() }

  const limitReached = status ? status.usedUsd >= status.budgetUsd : false

  return (
    <>
      <button className={`ai-launch ${open ? 'is-open' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="ai-panel">
        <Sparkles size={18} strokeWidth={1.9} /><span>{t('Assistent')}</span>
      </button>

      <aside id="ai-panel" className={`ai-panel ${open ? 'open' : ''}`} aria-label={t('Assistent')}>
        <header className="ai-head">
          <span className="ai-title"><Sparkles size={17} strokeWidth={1.9} />{t('Assistent')}</span>
          <span className="ai-head-actions">
            {chat.items.length > 0 && (
              <button className="icon-btn" onClick={reset} title={t('Neuer Chat')} aria-label={t('Neuer Chat')}><Plus size={18} /></button>
            )}
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('Schließen')}><X size={18} /></button>
          </span>
        </header>

        {!sync.auth ? (
          <div className="ai-empty">
            <p>{t('Der Assistent durchsucht deine Notizen und hilft dir beim Planen. Dafür brauchst du ein Konto, weil er auf deinen synchronisierten Stand zugreift.')}</p>
            <Link to="/einstellungen" className="btn primary" onClick={() => setOpen(false)}>{t('Anmelden oder registrieren')}</Link>
          </div>
        ) : status && !status.enabled ? (
          <div className="ai-empty"><p>{t('Der Assistent ist auf diesem Server noch nicht eingerichtet.')}</p></div>
        ) : (
          <>
            <div className="ai-list" ref={listRef} aria-live="polite">
              {chat.items.length === 0 && (
                <div className="ai-intro">
                  <p>{t('Frag mich nach deinen Notizen, Tasks, Projekten und Zielen – oder lass dir Tasks für ein Vorhaben vorschlagen. Gespeichert wird erst, wenn du sie übernimmst.')}</p>
                  <div className="ai-suggestions">
                    {SUGGESTIONS.map(s => <button key={s} className="ai-suggestion" onClick={() => send(t(s))}>{t(s)}</button>)}
                  </div>
                  <p className="muted small">{t('Journal-Einträge und Habits sieht der Assistent nicht.')}</p>
                </div>
              )}
              {chat.items.map((it, i) => (
                <div key={i} className={`ai-msg ${it.role}`}>
                  {it.text && <div className="ai-bubble">{it.text.trim()}</div>}
                  {it.sources && it.sources.length > 0 && <Sources items={it.sources} />}
                  {it.proposals?.map(p => (
                    <ProposalCard key={p.id} proposal={p} result={it.results?.[p.id]} disabled={busy} onResolve={r => resolve(i, p, r)} />
                  ))}
                  {it.error && <div className="ai-error" role="alert">{it.error}</div>}
                </div>
              ))}
              {busy && doing && <div className="ai-doing"><span className="ai-dot" />{doing}</div>}
            </div>

            <form className="ai-input" onSubmit={submit}>
              <textarea ref={inputRef} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
                maxLength={4000} disabled={limitReached}
                placeholder={limitReached ? t('Tageslimit erreicht – morgen geht es weiter') : t('Nachricht an den Assistenten …')} />
              {busy ? (
                <button type="button" className="ai-send" onClick={() => abort.current?.abort()} aria-label={t('Stoppen')}><Square size={14} fill="currentColor" /></button>
              ) : (
                <button type="submit" className="ai-send" disabled={!input.trim() || limitReached} aria-label={t('Senden')}><ArrowUp size={18} strokeWidth={2.2} /></button>
              )}
            </form>
          </>
        )}
      </aside>
    </>
  )
}

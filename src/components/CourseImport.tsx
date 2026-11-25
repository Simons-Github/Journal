import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Check as CheckIcon, FileUp, GraduationCap, Link as LinkIcon, MonitorPlay, Play } from 'lucide-react'
import { AiStatus, ApiError, api } from '../api'
import { ALL_KINDS, Course, KIND_LABEL, Kind, Pace, PlannedTask, overviewNote, plan, timestampLink, totalHours } from '../course'
import { newNote, newTask, useStore } from '../store'
import { useSync } from '../sync'
import { useEditor } from './Editor'
import { Modal } from './ui'
import { locale, t, useLang } from '../i18n'
import { addDays, fmtDate, fmtShort, today, uid } from '../utils'

const MIN_CHARS = 200
const MAX_CHARS = 300_000
/** Stunden im Format der Sprache: 7,5 bzw. 7.5 */
const hrs = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 })

const fmtSeconds = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min` }
type VideoChoice = { seconds: number | null; maxSeconds: number; from: string; to: string }
function videoRangeOk(v: VideoChoice): boolean {
  const from = Number(v.from || 0), to = Number(v.to)
  return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && (to - from) * 60 <= v.maxSeconds
}
/** Grobe Kosten mit Gemini 3.5 Flash-Lite (~132 Tokens pro Sekunde, 0,30 $ pro 1 Mio.) plus Ausgabe */
function videoCost(v: VideoChoice): string {
  const secs = Math.max(0, (Number(v.to) - Number(v.from || 0)) * 60)
  return (secs * 132 * 0.3e-6 + 0.02).toLocaleString(locale(), { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

/** Nächster Montag (heute, falls Montag) */
function nextMonday(): string {
  const d = today()
  const wd = (new Date().getDay() + 6) % 7
  return wd === 0 ? d : addDays(d, 7 - wd)
}

type Step =
  | { s: 'source' }
  | { s: 'running'; started: number; chars: number }
  | { s: 'review'; course: Course }
  | { s: 'done'; projectId: string; name: string; count: number }

/** Knopf „Kurs importieren“ mit dem Dialog dazu */
export function CourseImportButton({ className = 'chip', onOpen, initialLink, label }: { className?: string; onOpen?: () => void; initialLink?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => { onOpen?.(); setOpen(true) }}>
        <GraduationCap size={15} strokeWidth={1.9} />{label ?? t('Kurs importieren')}
      </button>
      {open && <CourseImport onClose={() => setOpen(false)} initialLink={initialLink} />}
    </>
  )
}

/** `initialLink`: Link aus dem Chat – wird direkt geladen, sobald der Dialog bereit ist */
export function CourseImport({ onClose, initialLink }: { onClose: () => void; initialLink?: string }) {
  const sync = useSync()
  const { lang } = useLang()
  const [step, setStep] = useState<Step>({ s: 'source' })
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [fileInfo, setFileInfo] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const enabled = status?.enabled ?? null
  const [link, setLink] = useState(initialLink ?? '')
  const autoLoaded = useRef(false)
  const [loadingLink, setLoadingLink] = useState(false)
  /** Ein YouTube-Video statt Text: Gemini analysiert es direkt */
  const [video, setVideo] = useState<{ url: string; title: string; seconds: number | null; maxSeconds: number; from: string; to: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (sync.auth) api.aiStatus().then(setStatus).catch(() => setStatus(null))
  }, [sync.auth])
  // Sekundenzähler während der Analyse
  useEffect(() => {
    if (step.s !== 'running') return
    const id = window.setInterval(() => tick(n => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [step.s])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (initialLink && status?.enabled && !autoLoaded.current) { autoLoaded.current = true; loadLink() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setFileInfo(t('Lese {name} …', { name: file.name }))
        const { pdfText } = await import('../pdfText')
        const r = await pdfText(file, (n, total) => setFileInfo(t('Lese {name} … Seite {n} von {total}', { name: file.name, n, total })))
        if (r.text.trim().length < MIN_CHARS) {
          setFileInfo('')
          setError(t('In dieser PDF steht kaum Text – vermutlich ist sie eingescannt. Kopiere den Text stattdessen aus der Kursseite.'))
          return
        }
        setText(r.text)
        setFileInfo(t(r.pages === 1 ? '{name}: 1 Seite' : '{name}: {pages} Seiten', { name: file.name, pages: r.pages }))
      } else {
        setText(await file.text())
        setFileInfo(file.name)
      }
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    } catch {
      setFileInfo('')
      setError(t('Die Datei konnte nicht gelesen werden.'))
    }
  }

  /** Kursseite, Playlist oder Video laden: Seiten und Playlists werden zu Text, den du vor der Analyse siehst */
  async function loadLink() {
    if (!link.trim()) return
    setError(''); setLoadingLink(true)
    try {
      const r = await api.aiFetchCourse(link.trim())
      if (r.kind === 'video') {
        const end = r.seconds ? Math.min(r.seconds, r.maxSeconds) : r.maxSeconds
        setVideo({ url: r.url, title: r.title, seconds: r.seconds, maxSeconds: r.maxSeconds, from: '0', to: String(Math.round(end / 60)) })
        if (r.title && !title) setTitle(r.title)
      } else {
        setVideo(null)
        setText(r.text)
        const playlist = r.pages[0]?.url.includes('youtube.com/playlist')
        setFileInfo(playlist
          ? t('Playlist „{title}“: {n} Videos', { title: r.pages[0].title, n: r.pages[0].chars })
          : t(r.pages.length === 1 ? '1 Seite geladen: {titles}' : '{n} Seiten geladen: {titles}', { n: r.pages.length, titles: r.pages.map(p => p.title.split(' | ')[0]).join(', ') }))
        // OCW-Titel sind „Seite | Kurs | Fach | MIT OpenCourseWare“ – der Kursname steht vorne
        if (!title && r.pages[0]?.title) setTitle(r.pages[0].title.split(' | ')[0])
      }
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t('Unbekannter Fehler'))
    } finally {
      setLoadingLink(false)
    }
  }

  async function analyse() {
    setError('')
    await sync.flush().catch(() => {})
    const ctrl = new AbortController()
    abort.current = ctrl
    setStep({ s: 'running', started: Date.now(), chars: 0 })
    let course: Course | null = null
    try {
      const req = video
        ? { video: video.url, start: Math.round(Number(video.from) * 60) || undefined, end: video.to ? Math.round(Number(video.to) * 60) : undefined, title: title.trim() || undefined, lang }
        : { text, title: title.trim() || undefined, lang }
      await api.aiCourse(req, e => {
        if (e.t === 'progress') setStep(s => (s.s === 'running' ? { ...s, chars: e.chars } : s))
        else if (e.t === 'result') course = e.course
        else if (e.t === 'error') setError(t(e.error))
      }, ctrl.signal)
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e instanceof ApiError ? t(e.message) : t('Unbekannter Fehler'))
    } finally {
      abort.current = null
    }
    if (course) setStep({ s: 'review', course })
    else setStep({ s: 'source' })
  }

  const cancel = () => { abort.current?.abort(); setStep({ s: 'source' }) }

  let body
  if (!sync.auth) {
    body = (
      <div className="ci-empty">
        <p>{t('Für den Kurs-Import brauchst du ein Konto, weil die Analyse über den Server läuft.')}</p>
        <Link to="/einstellungen" className="btn primary" onClick={onClose}>{t('Anmelden oder registrieren')}</Link>
      </div>
    )
  } else if (enabled === false) {
    body = (
      <div className="ci-empty">
        <p>{t('Der Kurs-Import arbeitet mit deinem eigenen Anthropic-API-Key – die Kosten laufen über dein Konto. Hinterlege ihn einmal in den Einstellungen.')}</p>
        <Link to="/einstellungen#ki" className="btn primary" onClick={onClose}>{t('Key hinterlegen')}</Link>
      </div>
    )
  } else if (step.s === 'source') {
    const tooShort = text.trim().length < MIN_CHARS
    body = (
      <>
        <p className="ci-lead">{t('Lade Syllabus, Kalender oder Aufgabenliste eines Kurses hoch – z. B. von MIT OpenCourseWare – oder füge den Text ein. Die KI liest die Struktur heraus, die Termine plant die App. Gespeichert wird erst nach deiner Prüfung.')}</p>
        <div className="ci-link">
          <LinkIcon size={17} strokeWidth={1.9} />
          <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadLink()} inputMode="url"
            placeholder={t('Link zur Kursseite, YouTube-Playlist oder zum Video')} aria-label={t('Link zur Kursseite, YouTube-Playlist oder zum Video')} />
          <button className="btn" onClick={loadLink} disabled={!link.trim() || loadingLink}>{loadingLink ? t('Lade …') : t('Laden')}</button>
        </div>
        {status && (!status.video || !status.playlists) && (
          <p className="muted small ci-hint">
            {!status.video && !status.playlists ? t('Für YouTube-Videos und -Playlists hinterlege einen Gemini- bzw. YouTube-Key in den Einstellungen – Kursseiten, Dateien und Text gehen auch ohne.')
              : !status.video ? t('Für einzelne YouTube-Videos hinterlege einen Gemini-Key in den Einstellungen.')
                : t('Für YouTube-Playlists hinterlege einen YouTube-Key in den Einstellungen.')}
            {' '}<Link to="/einstellungen#ki" onClick={onClose}>{t('Zu den Einstellungen')}</Link>
          </p>
        )}
        {video ? (
          <div className="ci-video">
            <div className="ci-video-head">
              <MonitorPlay size={18} strokeWidth={1.9} />
              <span className="strong">{video.title || video.url}</span>
              {video.seconds ? <span className="muted small">{fmtSeconds(video.seconds)}</span> : null}
              <button className="ai-link" onClick={() => setVideo(null)}>{t('Stattdessen Text verwenden')}</button>
            </div>
            <p className="muted small">{t('Gemini sieht und hört das Video und gliedert es in Abschnitte mit Zeitstempeln. Pro Durchgang höchstens {h} Stunden – längere Videos in mehreren Ausschnitten importieren.', { h: video.maxSeconds / 3600 })}</p>
            <div className="ci-range">
              <label>{t('Ab Minute')}<input type="number" min={0} value={video.from} onChange={e => setVideo({ ...video, from: e.target.value })} /></label>
              <label>{t('Bis Minute')}<input type="number" min={1} value={video.to} onChange={e => setVideo({ ...video, to: e.target.value })} /></label>
              <span className="muted small">{t('ca. {cost} $', { cost: videoCost(video) })}</span>
            </div>
          </div>
        ) : (<>
        <label className="ci-file">
          <FileUp size={18} strokeWidth={1.9} />
          <span>{fileInfo || t('PDF- oder Textdatei wählen')}</span>
          <input type="file" accept=".pdf,.txt,.md,.html,.htm,application/pdf,text/*" onChange={onFile} />
        </label>
        <textarea className="ci-text" value={text} onChange={e => { setText(e.target.value); setFileInfo('') }}
          placeholder={t('… oder Text hier einfügen (z. B. die Seiten „Syllabus“ und „Calendar“ eines OCW-Kurses)')} />
        </>)}
        <div className="ci-row">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Kurstitel (optional)')} aria-label={t('Kurstitel (optional)')} />
          {!video && (
            <span className={`small ${text.length > MAX_CHARS ? 'ci-warn' : 'muted'}`}>
              {t('{n} Zeichen', { n: text.length.toLocaleString() })}{text.length > MAX_CHARS ? ` – ${t('zu lang, bitte in Teilen importieren')}` : ''}
            </span>
          )}
        </div>
        {error && <div className="ai-error" role="alert">{error}</div>}
        <div className="ci-actions">
          <button className="btn primary" onClick={analyse} disabled={video ? !videoRangeOk(video) : tooShort || text.length > MAX_CHARS}>{video ? t('Video analysieren') : t('Kurs analysieren')}</button>
          <span className="muted small">{t('Dauert meist 30–120 Sekunden.')}</span>
        </div>
      </>
    )
  } else if (step.s === 'running') {
    const secs = Math.round((Date.now() - step.started) / 1000)
    body = (
      <div className="ci-running">
        <span className="ai-dot" />
        <div>
          <div className="strong">{t('Analysiere den Kurs …')}</div>
          <div className="muted small">{t('{s} s', { s: secs })}{step.chars ? ` · ${t('{n} Zeichen Struktur erhalten', { n: step.chars.toLocaleString() })}` : ''}</div>
        </div>
        <button className="btn" onClick={cancel}>{t('Abbrechen')}</button>
      </div>
    )
  } else if (step.s === 'review') {
    body = <Review course={step.course} onBack={() => setStep({ s: 'source' })} onDone={(projectId, name, count) => setStep({ s: 'done', projectId, name, count })} />
  } else {
    body = <Done {...step} onClose={onClose} />
  }

  return (
    <Modal onClose={step.s === 'running' ? () => {} : onClose} wide>
      <h2 className="ci-title"><GraduationCap size={22} strokeWidth={1.7} />{t('Kurs importieren')}</h2>
      {body}
    </Modal>
  )
}

function Done({ projectId, name, count, onClose }: { projectId: string; name: string; count: number; onClose: () => void }) {
  const ed = useEditor()
  return (
    <div className="ci-empty">
      <p className="ci-done"><CheckIcon size={18} strokeWidth={2.2} />{t('Projekt „{name}“ mit {n} Tasks angelegt.', { name, n: count })}</p>
      <div className="ci-actions">
        <button className="btn primary" onClick={() => { onClose(); ed.open('project', projectId) }}>{t('Projekt öffnen')}</button>
        <button className="btn" onClick={onClose}>{t('Schließen')}</button>
      </div>
    </div>
  )
}

interface Edit { on?: boolean; title?: string; due?: string }

function Review({ course, onBack, onDone }: { course: Course; onBack: () => void; onDone: (projectId: string, name: string, count: number) => void }) {
  const { db, update } = useStore()
  const [name, setName] = useState(course.title)
  const [start, setStart] = useState(nextMonday)
  const [mode, setMode] = useState<Pace['mode']>('course')
  const [hours, setHours] = useState(8)
  const [kinds, setKinds] = useState<Set<Kind>>(() => new Set(ALL_KINDS))
  const [goalId, setGoalId] = useState('')
  const [areaId, setAreaId] = useState(() => db.areas.find(a => /schule|school|studium|study/i.test(a.name))?.id ?? '')
  const [withNote, setWithNote] = useState(true)
  const [edits, setEdits] = useState<Record<string, Edit>>({})

  const present = useMemo(() => ALL_KINDS.filter(k => course.units.some(u => u.items.some(i => i.kind === k))), [course])
  const pace: Pace = mode === 'course' ? { mode } : { mode, hoursPerWeek: hours }
  const planned = useMemo(() => plan(course, start, pace, kinds), [course, start, mode, hours, kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = planned.map(p => {
    const e = edits[p.key] ?? {}
    return { ...p, on: e.on ?? true, title: e.title ?? p.title, due: e.due ?? p.due }
  })
  const chosen = rows.filter(r => r.on && r.title.trim())
  const unverified = rows.filter(r => !r.verified).length
  const weeks = [...new Set(rows.map(r => r.planWeek))].sort((a, b) => a - b)
  const lastDue = chosen.reduce((m, r) => (r.due > m ? r.due : m), '')

  const edit = (key: string, e: Edit) => setEdits(x => ({ ...x, [key]: { ...x[key], ...e } }))
  // Neue Planung (Start/Tempo): selbst gesetzte Termine verwerfen, Auswahl und Titel behalten
  const replan = (fn: () => void) => { fn(); setEdits(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, due: undefined }]))) }
  const toggleKind = (k: Kind) => setKinds(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  function create() {
    if (!chosen.length || !name.trim()) return
    const projectId = uid()
    const tasks = chosen.map(r => newTask({ title: r.title.trim(), due: r.due || undefined, priority: r.priority, projectId }))
    const note = withNote ? newNote({
      title: t('{name} – Kursübersicht', { name: name.trim() }),
      type: 'Lernzettel/Mitschrift',
      areaId: areaId || undefined,
      content: overviewNote(course, chosen as PlannedTask[], fmtDate, k => t(KIND_LABEL[k]), n => t('Woche {n}', { n })),
    }) : null
    update(d => {
      d.projects.unshift({ id: projectId, name: name.trim(), status: 'Doing', areaId: areaId || undefined, goalId: goalId || undefined })
      d.tasks.unshift(...tasks)
      if (note) d.notes.unshift(note)
    })
    onDone(projectId, name.trim(), tasks.length)
  }

  const goals = db.goals.filter(g => !g.done)
  const areas = db.areas.filter(a => !a.archived)

  return (
    <div className="ci-review">
      <div className="ci-course">
        <input className="ci-name" value={name} onChange={e => setName(e.target.value)} aria-label={t('Projektname')} />
        {course.provider && <div className="muted small">{course.provider}</div>}
        {course.summary && <p className="ci-summary">{course.summary}</p>}
      </div>

      {(course.warnings.length > 0 || course.weeks_inferred || unverified > 0 || course.source) && (
        <div className="ci-warnings">
          <AlertTriangle size={16} strokeWidth={2} />
          <ul>
            {course.source?.kind === 'video' && <li>{t('Aus einem Video: Die Einträge lassen sich nicht wörtlich prüfen. Die Zeitstempel führen zur passenden Stelle – prüfe ein paar davon.')}</li>}
            {course.weeks_inferred && <li>{t('Im Material gibt es keinen Wochenplan – die KI hat die Einheiten selbst auf Wochen verteilt.')}</li>}
            {unverified > 0 && <li>{t(unverified === 1 ? 'Ein Eintrag ließ sich nicht wörtlich im Material wiederfinden. Er ist markiert – bitte prüfen.' : '{n} Einträge ließen sich nicht wörtlich im Material wiederfinden. Sie sind markiert – bitte prüfen.', { n: unverified })}</li>}
            {course.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="ci-settings">
        <label>{t('Start')}<input type="date" value={start} onChange={e => e.target.value && replan(() => setStart(e.target.value))} /></label>
        <label>{t('Tempo')}
          <select value={mode} onChange={e => replan(() => setMode(e.target.value as Pace['mode']))}>
            <option value="course">{t('Wie im Kursplan (1 Kurswoche = 1 Woche)')}</option>
            <option value="hours">{t('Nach Stunden pro Woche')}</option>
          </select>
        </label>
        {mode === 'hours' && (
          <label>{t('Stunden pro Woche')}<input type="number" min={1} max={60} value={hours} onChange={e => replan(() => setHours(Math.max(1, Number(e.target.value) || 1)))} /></label>
        )}
        <label>{t('Ziel')}
          <select value={goalId} onChange={e => setGoalId(e.target.value)}>
            <option value="">{t('– kein Ziel –')}</option>
            {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
        <label>{t('Area')}
          <select value={areaId} onChange={e => setAreaId(e.target.value)}>
            <option value="">{t('– keine Area –')}</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </label>
      </div>

      <div className="ci-kinds" role="group" aria-label={t('Arten')}>
        {present.map(k => (
          <button key={k} className={`ci-kind ${kinds.has(k) ? 'on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => replan(() => toggleKind(k))}>{t(KIND_LABEL[k])}</button>
        ))}
      </div>

      <div className="ci-weeks">
        {weeks.map(w => {
          const ws = rows.filter(r => r.planWeek === w)
          const from = addDays(start, w * 7)
          return (
            <section key={w} className="ci-week">
              <div className="ci-week-head">
                <span className="strong">{t('Woche {n}', { n: w + 1 })}</span>
                <span className="muted small">{fmtShort(from)}–{fmtShort(addDays(from, 6))} · {t('{h} h', { h: hrs(totalHours(ws.filter(r => r.on))) })}</span>
              </div>
              <ul className="ci-rows">
                {ws.map(r => (
                  <li key={r.key} className={r.on ? '' : 'off'}>
                    <input type="checkbox" checked={r.on} onChange={e => edit(r.key, { on: e.target.checked })} aria-label={t('Übernehmen')} />
                    <input className="ci-row-title" value={r.title} onChange={e => edit(r.key, { title: e.target.value })} aria-label={t('Titel')} />
                    {!r.verified && (
                      <span className="ci-unverified" title={t('Nicht wörtlich im Material gefunden: „{q}“', { q: r.quote })}>
                        <AlertTriangle size={14} strokeWidth={2} />
                      </span>
                    )}
                    {course.source?.kind === 'video' && (() => {
                      const ts = timestampLink(course.source.url, r.quote)
                      return ts && <a className="ci-ts" href={ts.href} target="_blank" rel="noreferrer" title={r.quote}><Play size={11} fill="currentColor" />{ts.label}</a>
                    })()}
                    <span className={`ci-kind-tag k-${r.kind}`}>{t(KIND_LABEL[r.kind])}</span>
                    <span className="muted small ci-hours">{t('{h} h', { h: hrs(r.hours) })}</span>
                    <input type="date" value={r.due} onChange={e => edit(r.key, { due: e.target.value })} aria-label={t('Fällig')} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        {!rows.length && <div className="empty">{t('Keine Einträge ausgewählt.')}</div>}
      </div>

      <label className="ci-note"><input type="checkbox" checked={withNote} onChange={e => setWithNote(e.target.checked)} />{t('Übersichtsnotiz mit Zusammenfassung und Wochenplan anlegen')}</label>

      <div className="ci-footer">
        <span className="muted small">
          {t('{n} Tasks · {h} h', { n: chosen.length, h: hrs(totalHours(chosen)) })}{lastDue ? ` · ${t('bis {date}', { date: fmtDate(lastDue) })}` : ''}
        </span>
        <span className="ci-actions">
          <button className="btn" onClick={onBack}>{t('Zurück')}</button>
          <button className="btn primary" onClick={create} disabled={!chosen.length || !name.trim()}>
            {t('Projekt mit {n} Tasks anlegen', { n: chosen.length })}
          </button>
        </span>
      </div>
    </div>
  )
}

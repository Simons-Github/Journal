import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, Moon, NotebookPen, Plus, Sun } from 'lucide-react'
import { PRIORITIES, useStore } from '../store'
import { REVIEW_STEPS, addDays, diffDays, fmtDate, startOfWeek, today } from '../utils'
import { useEditor } from '../components/Editor'
import { HabitChart, HabitChecklist } from '../components/Habits'
import { ProjectTable } from '../components/Boards'
import { TaskList } from '../components/TaskList'
import { Check, Empty, Pill, Section, Tabs } from '../components/ui'
import { useJournalActions } from './Journal'
import { locale, t as tr } from '../i18n'

const TASK_TABS = ['Heute', 'Diese Woche', 'Projects'] as const

function greetingFor(h: number) {
  if (h < 5) return tr('Gute Nacht')
  if (h < 11) return tr('Guten Morgen')
  if (h < 17) return tr('Guten Tag')
  if (h < 22) return tr('Guten Abend')
  return tr('Gute Nacht')
}

function useNow() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(i) }, [])
  return now
}

export default function Dashboard() {
  const { db, update, patch } = useStore()
  const ed = useEditor()
  const a = useJournalActions()
  const now = useNow()
  const [tt, setTt] = useState<(typeof TASK_TABS)[number]>('Heute')
  const t = today()

  const open = db.tasks.filter(x => !x.done)
  const tabTasks = tt === 'Heute'
    ? open.filter(x => x.due && x.due <= t)
    : open.filter(x => x.due && x.due <= addDays(startOfWeek(t), 6))

  const goodHabits = db.habits.filter(h => h.kind === 'good' && !h.archived)
  const doneToday = (db.habitLog[t] || []).filter(id => goodHabits.some(h => h.id === id)).length

  const recent = [
    ...db.days.map(d => ({ id: d.id, date: d.date, kind: 'morning', label: 'Morning', text: d.brainDump || d.gratitude.filter(Boolean).join(', '), to: `/morgen/${d.id}` })),
    ...db.evenings.map(d => ({ id: d.id, date: d.date, kind: 'evening', label: 'Evening', text: d.brainDump, to: `/abend/${d.id}` })),
    ...db.weeks.map(d => ({ id: d.id, date: d.date, kind: 'week', label: 'Weekly', text: d.wentWell || d.reflection, to: `/woche/${d.id}` })),
  ].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6)

  const dueReviews = db.notes.filter(n => n.nextReview && n.nextReview <= t && !n.archived)

  return (
    <>
      <header className="today-head">
        <div>
          <h1 className="greeting">
            {greetingFor(now.getHours())},{' '}
            <input className="name-input" value={db.name} placeholder={tr('dein Name')} aria-label={tr('Dein Name')}
              size={Math.max(8, db.name.length + 1)} onChange={e => update(d => { d.name = e.target.value })} />
          </h1>
          <p className="today-date">{now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <CycleProgress start={db.cycleStart} />
      </header>

      <DayArc now={now} morningWritten={db.days.some(d => d.date === t)} eveningWritten={db.evenings.some(d => d.date === t)}
        onMorning={a.newDay} onEvening={a.newEvening} />

      <div className="quick" aria-label={tr('Schnell erfassen')}>
        <button className="chip" onClick={() => ed.createTask({ due: t })}><Plus size={15} />Task</button>
        <button className="chip" onClick={() => ed.createNote()}><NotebookPen size={15} />Note</button>
        <button className="chip" onClick={a.newWeek}><CalendarRange size={15} />Weekly Review</button>
      </div>

      <div className="today-grid">
        <div className="stack">
          <Section title="Habits heute" actions={<Link className="chip" to="/habits">{tr('Alle')}</Link>}>
            <div className="habit-ring">
              <Ring value={goodHabits.length ? doneToday / goodHabits.length : 0} />
              <div>
                <div className="ring-num">{tr('{a} von {b}', { a: doneToday, b: goodHabits.length })}</div>
                <div className="muted small">{doneToday === goodHabits.length && goodHabits.length ? tr('Alles erledigt für heute') : tr('erledigt')}</div>
              </div>
            </div>
            <HabitChecklist date={t} />
          </Section>

          {dueReviews.length > 0 && (
            <Section title="Heute wiederholen">
              <div className="list">
                {dueReviews.map(n => (
                  <div key={n.id} className="list-row">
                    <button className="link" onClick={() => ed.open('note', n.id)}>{n.title || tr('Unbenannt')}</button>
                    <Check checked={false} strike={false} label={tr('Wiederholt')} onChange={() => patch('notes', n.id, {
                      reviewCount: n.reviewCount + 1,
                      nextReview: addDays(t, REVIEW_STEPS[Math.min(n.reviewCount, REVIEW_STEPS.length - 1)]),
                    })} />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="stack">
          <Section title="Tasks" actions={<button className="chip" onClick={() => ed.createTask({ due: t })}><Plus size={14} />{tr('Neu')}</button>}>
            <Tabs tabs={TASK_TABS} value={tt} onChange={setTt} />
            {tt === 'Projects'
              ? <ProjectTable projects={db.projects.filter(p => !p.archived)} />
              : tabTasks.length === 0
                ? <Empty>{tt === 'Heute' ? 'Für heute ist nichts geplant.' : 'Diese Woche ist nichts geplant.'}</Empty>
                : (
                  <div className="prio-groups">
                    {PRIORITIES.map(p => {
                      const list = tabTasks.filter(x => x.priority === p)
                      if (!list.length) return null
                      return (
                        <div key={p || 'none'} className="prio-group">
                          <div className="prio-head">
                            <Pill tone={p === 'Hoch' ? 'red' : p === 'Mittel' ? 'orange' : p === 'Gering' ? 'green' : 'gray'}>{p ? tr(`Priorität ${p.toLowerCase()}`) : tr('Ohne Priorität')}</Pill>
                            <span className="muted small">{list.length}</span>
                          </div>
                          <TaskList tasks={list} />
                        </div>
                      )
                    })}
                  </div>
                )}
          </Section>

          <Section title="Habits der letzten 30 Tage">
            <HabitChart />
          </Section>

          <Section title="Zuletzt geschrieben" plain>
            {recent.length ? recent.map(r => (
              <Link key={r.kind + r.id} to={r.to} className="entry-row">
                <span className={`entry-kind ${r.kind}`}>{r.label}</span>
                <span className="entry-preview">{r.text || <span className="muted">{tr('Noch nichts notiert')}</span>}</span>
                <span className="muted small">{fmtDate(r.date, { day: 'numeric', month: 'short' })}</span>
              </Link>
            )) : <Empty>Dein erster Eintrag fehlt noch. Beginne mit dem Morning Journal.</Empty>}
          </Section>
        </div>
      </div>
    </>
  )
}

/** 12-Wochen-Jahr als kompakte Leiste */
function CycleProgress({ start }: { start: string }) {
  const t = today()
  const d = diffDays(t, start)
  const week = Math.floor(d / 7) + 1
  const label = d < 0 ? tr('Startet in {n} Tagen', { n: -d }) : week > 12 ? tr('Zyklus abgeschlossen') : <>{tr('Woche')} <b>{week}</b> {tr('von 12')}</>
  return (
    <Link to="/ziele" className="cycle" aria-label={tr('Zu den Goals')}>
      <div className="cycle-label"><span>{tr('12-Wochen-Jahr')}</span><span>{label}</span></div>
      <div className="cycle-track">
        {Array.from({ length: 12 }, (_, i) => <span key={i} className={i + 1 < week ? 'past' : i + 1 === week ? 'now' : ''} />)}
      </div>
    </Link>
  )
}

function Ring({ value }: { value: number }) {
  const r = 26, c = 2 * Math.PI * r
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle cx="32" cy="32" r={r} className="ring-value" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 32 32)" />
    </svg>
  )
}

/** Misst ein Element, damit SVG-Beschriftungen in echter Pixelgröße bleiben */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * Der Tagesbogen: Der Tag läuft von 6 bis 23 Uhr als Bogen über einem Horizont,
 * vom Morgen- zum Abend-Journal. Die Sonne zeigt die aktuelle Uhrzeit.
 */
function DayArc({ now, morningWritten, eveningWritten, onMorning, onEvening }: {
  now: Date; morningWritten: boolean; eveningWritten: boolean; onMorning: () => void; onEvening: () => void
}) {
  const START = 6, END = 23
  const hours = now.getHours() + now.getMinutes() / 60
  const f = Math.min(1, Math.max(0, (hours - START) / (END - START)))
  const [boxRef, { w, h }] = useSize<HTMLDivElement>()
  const time = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  const sunColor = f < 0.5 ? 'var(--morning)' : 'var(--evening)'

  // Geometrie in echten Pixeln: Horizont unten, Bogen darüber
  const pad = 26
  const cx = w / 2, cy = h - 26, rx = Math.max(0, w / 2 - pad), ry = Math.max(0, cy - 30)
  const at = (t: number) => ({ x: cx - rx * Math.cos(Math.PI * t), y: cy - ry * Math.sin(Math.PI * t) })
  const sun = at(f)
  const anchor = f < 0.08 ? 'start' : f > 0.92 ? 'end' : 'middle'
  const labelX = anchor === 'start' ? sun.x - 8 : anchor === 'end' ? sun.x + 8 : sun.x
  const noon = (12 - START) / (END - START)

  return (
    <section className="day-arc" aria-label={tr('Dein Tag: {time} Uhr', { time })}>
      <div className="arc-box" ref={boxRef}>
        {w > 0 && (
          <svg className="arc-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
            <defs>
              <linearGradient id="arcGradient" gradientUnits="userSpaceOnUse" x1={cx - rx} x2={cx + rx} y1="0" y2="0">
                <stop offset="0%" stopColor="var(--morning)" />
                <stop offset="100%" stopColor="var(--evening)" />
              </linearGradient>
            </defs>
            <line x1={0} x2={w} y1={cy} y2={cy} stroke="var(--line)" />
            <path className="arc-track" d={`M${cx - rx},${cy} A${rx},${ry} 0 0 1 ${cx + rx},${cy}`} />
            {Array.from({ length: END - START + 1 }, (_, i) => {
              const p = at(i / (END - START))
              return <circle key={i} className="arc-tick" cx={p.x} cy={p.y} r={i % 3 === 0 ? 1.6 : 1} />
            })}
            {f > 0 && (
              <path className="arc-done" pathLength={1} strokeDasharray="1 1"
                d={`M${cx - rx},${cy} A${rx},${ry} 0 0 1 ${sun.x.toFixed(1)},${sun.y.toFixed(1)}`} />
            )}
            <circle className="arc-halo" cx={sun.x} cy={sun.y} r={15} fill={sunColor} />
            <circle className="arc-sun" cx={sun.x} cy={sun.y} r={6.5} fill={sunColor} />
            <text className="arc-now" x={labelX} y={sun.y - 22} textAnchor={anchor}>{time}</text>
            <text className="arc-hour" x={cx - rx} y={cy + 19} textAnchor="middle">{tr('6 Uhr')}</text>
            <text className="arc-hour" x={at(noon).x} y={cy + 19} textAnchor="middle">{tr('Mittag')}</text>
            <text className="arc-hour" x={cx + rx} y={cy + 19} textAnchor="middle">{tr('23 Uhr')}</text>
          </svg>
        )}
      </div>
      <div className="arc-anchors">
        <button className={`ritual morning ${morningWritten ? 'is-written' : ''}`} onClick={onMorning}>
          <span className="ritual-icon"><Sun size={20} strokeWidth={1.8} /></span>
          <span className="ritual-text">
            <span className="ritual-title">Morning Journal</span>
            <span className="ritual-state">{morningWritten ? tr('Heute geschrieben') : tr('Habits, Gedanken, Dankbarkeit')}</span>
          </span>
          <span className="ritual-cta">{morningWritten ? tr('Öffnen') : tr('Beginnen')}</span>
        </button>
        <button className={`ritual evening ${eveningWritten ? 'is-written' : ''}`} onClick={onEvening}>
          <span className="ritual-icon"><Moon size={20} strokeWidth={1.8} /></span>
          <span className="ritual-text">
            <span className="ritual-title">Evening Journal</span>
            <span className="ritual-state">{eveningWritten ? tr('Heute geschrieben') : tr('Rückblick und Kopf leeren')}</span>
          </span>
          <span className="ritual-cta">{eveningWritten ? tr('Öffnen') : tr('Beginnen')}</span>
        </button>
      </div>
    </section>
  )
}


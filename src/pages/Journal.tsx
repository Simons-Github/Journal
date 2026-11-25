import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { EVENING_CHECKS, WEEK_CHECKS, habitRate, useStore } from '../store'
import { addDays, fmtDate, startOfWeek, today, uid, weekday } from '../utils'
import { useEditor } from '../components/Editor'
import { HabitChecklist } from '../components/Habits'
import { GoalsByArea, ProjectBoard } from '../components/Boards'
import { TaskList } from '../components/TaskList'
import { WeekCalendar } from '../components/WeekCalendar'
import { AutoText, Check, Empty, PageHeader, Progress, Section, Tabs } from '../components/ui'
import { t as tr } from '../i18n'

export function useJournalActions() {
  const { db, add } = useStore()
  const nav = useNavigate()
  return {
    newDay: () => {
      const t = today()
      const ex = db.days.find(d => d.date === t)
      if (ex) return nav(`/morgen/${ex.id}`)
      const id = uid()
      add('days', { id, date: t, title: fmtDate(t), brainDump: '', gratitude: ['', '', ''] })
      nav(`/morgen/${id}`)
    },
    newEvening: () => {
      const t = today()
      const ex = db.evenings.find(d => d.date === t)
      if (ex) return nav(`/abend/${ex.id}`)
      const id = uid()
      add('evenings', { id, date: t, title: fmtDate(t), brainDump: '', checks: {} })
      nav(`/abend/${id}`)
    },
    newWeek: () => {
      const w = startOfWeek(today())
      const ex = db.weeks.find(d => d.date === w)
      if (ex) return nav(`/woche/${ex.id}`)
      const id = uid()
      add('weeks', { id, date: w, title: tr('Woche ab {date}', { date: fmtDate(w) }), wentWell: '', burden: '', reflection: '', checks: {} })
      nav(`/woche/${id}`)
    },
  }
}

function useNext7Tasks() {
  const { db } = useStore()
  const t = today(), end = addDays(t, 7)
  return db.tasks.filter(x => !x.done && x.due && x.due <= end)
}

type Entry = { id: string; date: string; title: string; preview: string }
const ENTRY_VIEWS = ['Liste', 'Galerie', 'Tabelle'] as const

/** Einträge wie im Template als Liste, Galerie oder Tabelle */
function EntryViews({ items, base, empty, showHabits = true }: { items: Entry[]; base: string; empty: string; showHabits?: boolean }) {
  const { db } = useStore()
  const [view, setView] = useState<(typeof ENTRY_VIEWS)[number]>('Liste')
  if (!items.length) return <Empty>{empty}</Empty>
  const title = (e: Entry) => e.title || fmtDate(e.date)
  return (
    <>
      <Tabs tabs={ENTRY_VIEWS} value={view} onChange={setView} />
      {view === 'Liste' && (
        <div className="list">
          {items.map(e => (
            <Link key={e.id} to={`${base}/${e.id}`} className="list-row">
              <span>{title(e)}</span><span className="muted small">{weekday(e.date)}, {fmtDate(e.date)}</span>
            </Link>
          ))}
        </div>
      )}
      {view === 'Galerie' && (
        <div className="gallery">
          {items.map(e => (
            <Link key={e.id} to={`${base}/${e.id}`} className="gallery-card">
              <div className="gc-title">{title(e)}</div>
              <div className="muted small">{weekday(e.date)}, {fmtDate(e.date)}</div>
              {e.preview && <p className="gc-preview">{e.preview}</p>}
            </Link>
          ))}
        </div>
      )}
      {view === 'Tabelle' && (
        <div className="table-wrap">
          <table className="db-table">
            <thead><tr><th>Name</th><th>{tr('Datum')}</th>{showHabits && <th>Habits</th>}<th>{tr('Notiz')}</th></tr></thead>
            <tbody>
              {items.map(e => (
                <tr key={e.id}>
                  <td className="strong"><Link to={`${base}/${e.id}`}>{title(e)}</Link></td>
                  <td className="nowrap">{fmtDate(e.date)}</td>
                  {showHabits && <td><Progress value={habitRate(db, e.date)} /></td>}
                  <td className="muted small">{e.preview.slice(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DeleteEntry({ onDelete }: { onDelete: () => void }) {
  return <button className="btn danger ghost" onClick={() => confirm(tr('Eintrag löschen?')) && onDelete()}>{tr('Eintrag löschen')}</button>
}

// ------------------- Morgen -------------------
export function MorningList() {
  const { db } = useStore()
  const a = useJournalActions()
  const items = [...db.days].sort((x, y) => y.date.localeCompare(x.date)).map(d => ({ ...d, preview: d.brainDump }))
  return (
    <>
      <PageHeader icon="☀️" title="Morning" cover="morning" />
      <div className="toolbar"><button className="btn primary" onClick={a.newDay}>{tr('Neuer Eintrag')}</button></div>
      <EntryViews items={items} base="/morgen" empty="Noch keine Tage. Starte mit „Neuer Tag“." />
    </>
  )
}

export function DayPage() {
  const { id } = useParams()
  const { db, patch, remove } = useStore()
  const nav = useNavigate()
  const ed = useEditor()
  const next7 = useNext7Tasks()
  const d = db.days.find(x => x.id === id)
  if (!d) return <Empty>Eintrag nicht gefunden.</Empty>
  const set = (p: Partial<typeof d>) => patch('days', d.id, p)
  return (
    <>
      <PageHeader icon="☀️" title="" cover="morning">
        <input className="page-title-input" value={d.title} onChange={e => set({ title: e.target.value })} />
        <div className="props-inline">
          <span className="muted">{tr('Datum')}</span>
          <input type="date" value={d.date} onChange={e => set({ date: e.target.value })} />
        </div>
      </PageHeader>
      <div className="grid-2">
        <Section title="Morning Habits" icon="✅"><HabitChecklist date={d.date} routine="morgen" /></Section>
        <div className="stack">
          <Section title="Kopf leeren" icon="🧠">
                        <AutoText value={d.brainDump} onChange={brainDump => set({ brainDump })} placeholder={tr('Was geht dir heute Morgen durch den Kopf?')} />
          </Section>
          <Section title="Dankbarkeit" icon="🙏">
            <ol className="gratitude">
              {d.gratitude.map((g, i) => (
                <li key={i}><input value={g} placeholder={tr('Ich bin dankbar für …')} onChange={e => {
                  const gratitude = [...d.gratitude]; gratitude[i] = e.target.value; set({ gratitude })
                }} /></li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
      <Section title="Goals & Projects" icon="🎯">
        <h3 className="sub">Goals</h3>
        <GoalsByArea />
        <h3 className="sub">Projects</h3>
        <ProjectBoard projects={db.projects.filter(p => !p.archived)} />
      </Section>
      <Section title="Was steht heute an?" icon="📋" actions={<button className="chip" onClick={() => ed.createTask({ due: d.date })}>+ Task</button>}>
        <p className="hint">{tr('Hier siehst du die Tasks der nächsten 7 Tage. Guck, was du heute erledigen willst und was du rumschiebst.')}</p>
        <h3 className="sub">Tasks</h3>
        <TaskList tasks={next7} />
        <h3 className="sub">{tr('Kalender')}</h3>
        <WeekCalendar start={d.date} />
      </Section>
      <DeleteEntry onDelete={() => { remove('days', d.id); nav('/morgen') }} />
    </>
  )
}

// ------------------- Abend -------------------
export function EveningList() {
  const { db } = useStore()
  const a = useJournalActions()
  const items = [...db.evenings].sort((x, y) => y.date.localeCompare(x.date)).map(d => ({ ...d, preview: d.brainDump }))
  return (
    <>
      <PageHeader icon="🌙" title="Evening" cover="evening" />
      <div className="toolbar"><button className="btn primary" onClick={a.newEvening}>{tr('Neuer Eintrag')}</button></div>
      <EntryViews items={items} base="/abend" empty="Noch keine Abende. Starte mit „Neuer Abend“." />
    </>
  )
}

export function EveningPage() {
  const { id } = useParams()
  const { db, patch, remove } = useStore()
  const nav = useNavigate()
  const ed = useEditor()
  const next7 = useNext7Tasks()
  const e = db.evenings.find(x => x.id === id)
  if (!e) return <Empty>Eintrag nicht gefunden.</Empty>
  const set = (p: Partial<typeof e>) => patch('evenings', e.id, p)
  return (
    <>
      <PageHeader icon="🌙" title="" cover="evening">
        <input className="page-title-input" value={e.title} onChange={x => set({ title: x.target.value })} />
        <div className="props-inline">
          <span className="muted">{tr('Datum')}</span>
          <input type="date" value={e.date} onChange={x => set({ date: x.target.value })} />
        </div>
      </PageHeader>
      <div className="grid-2">
        <Section title="Habits heute" icon="✅"><HabitChecklist date={e.date} /></Section>
        <div className="stack">
          <Section title="Evening Habits" icon="✨"><HabitChecklist date={e.date} routine="abend" /></Section>
          <Section title="Zur Ruhe kommen" icon="🌙">
            <div className="habit-list">
              {EVENING_CHECKS.map(c => (
                <Check key={c} checked={!!e.checks[c]} label={tr(c)} onChange={v => set({ checks: { ...e.checks, [c]: v } })} />
              ))}
            </div>
          </Section>
        </div>
      </div>
      <Section title="Kopf leeren" icon="🧠">
                <AutoText value={e.brainDump} onChange={brainDump => set({ brainDump })} placeholder={tr('Was nimmst du aus diesem Tag mit?')} />
      </Section>
      <Section title="Willst du etwas ändern?" icon="🔁" actions={<button className="chip" onClick={() => ed.createTask({ due: addDays(e.date, 1) })}>+ Task</button>}>
        <p className="hint">{tr('Hier siehst du die Tasks der nächsten 7 Tage. Vielleicht hat der Brain Dump dir Klarheit gegeben und du kannst Tasks löschen oder hinzufügen.')}</p>
        <TaskList tasks={next7} />
      </Section>
      <DeleteEntry onDelete={() => { remove('evenings', e.id); nav('/abend') }} />
    </>
  )
}

// ------------------- Woche -------------------
export function WeekList() {
  const { db } = useStore()
  const a = useJournalActions()
  const items = [...db.weeks].sort((x, y) => y.date.localeCompare(x.date)).map(d => ({ ...d, preview: d.wentWell }))
  return (
    <>
      <PageHeader icon="🗓️" title="Weekly Review" cover="week" />
      <div className="toolbar"><button className="btn primary" onClick={a.newWeek}>{tr('Neuer Weekly Review')}</button></div>
      <EntryViews showHabits={false} items={items} base="/woche" empty="Noch keine Wochen. Starte mit „Neue Woche“." />
    </>
  )
}

export function WeekPage() {
  const { id } = useParams()
  const { db, patch, remove } = useStore()
  const nav = useNavigate()
  const w = db.weeks.find(x => x.id === id)
  if (!w) return <Empty>Eintrag nicht gefunden.</Empty>
  const set = (p: Partial<typeof w>) => patch('weeks', w.id, p)
  const end = addDays(w.date, 6)
  const weekTasks = db.tasks.filter(t => t.due && t.due >= w.date && t.due <= end)
  return (
    <>
      <PageHeader icon="🗓️" title="" cover="week">
        <input className="page-title-input" value={w.title} onChange={x => set({ title: x.target.value })} />
        <div className="props-inline"><span className="muted">{fmtDate(w.date)} – {fmtDate(end)}</span></div>
      </PageHeader>
      <div className="grid-2">
        <Section title="Was lief gut?" icon="🌟">
          <AutoText value={w.wentWell} onChange={wentWell => set({ wentWell })} placeholder={tr('Momente, Erfolge, kleine Dinge …')} />
        </Section>
        <Section title="Belastet mich etwas?" icon="🪨">
          <AutoText value={w.burden} onChange={burden => set({ burden })} placeholder={tr('Was liegt dir auf der Seele?')} />
        </Section>
      </div>
      <Section title="Wie laufen Goals, Projects und Tasks?" icon="📊">
        <h3 className="sub">Goals</h3>
        <GoalsByArea />
        <h3 className="sub">Projects</h3>
        <ProjectBoard projects={db.projects.filter(p => !p.archived)} />
        <h3 className="sub">{tr('Tasks dieser Woche')}</h3>
        <TaskList tasks={weekTasks} empty="Keine Tasks in dieser Woche" />
        <h3 className="sub">{tr('Notizen zur Woche')}</h3>
        <AutoText value={w.reflection} onChange={reflection => set({ reflection })} placeholder={tr('Was nimmst du dir für nächste Woche vor?')} />
      </Section>
      <Section title="Bereit für die neue Woche?" icon="✅">
        <div className="habit-list">
          {WEEK_CHECKS.map(c => <Check key={c} checked={!!w.checks[c]} label={tr(c)} onChange={v => set({ checks: { ...w.checks, [c]: v } })} />)}
        </div>
      </Section>
      <DeleteEntry onDelete={() => { remove('weeks', w.id); nav('/woche') }} />
    </>
  )
}


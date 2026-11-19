import { useState } from 'react'
import { PRIORITIES, useStore } from '../store'
import { addDays, isoDate, parseDate, today } from '../utils'
import { useEditor } from '../components/Editor'
import { ProjectBoard, ProjectTable } from '../components/Boards'
import { TaskList } from '../components/TaskList'
import { PageHeader, Pill, Section, Tabs, statusTone } from '../components/ui'
import { locale, t as tr } from '../i18n'

const VIEWS = ['Eingang', 'Heute', 'Morgen', 'Nächste 7 Tage', 'Später', 'Nach Priorität', 'Alle', 'Erledigt', 'Zeitleiste'] as const
const PVIEWS = ['Board', 'Tabelle', 'Archiv'] as const

export default function TodoManager() {
  const { db } = useStore()
  const ed = useEditor()
  const [v, setV] = useState<(typeof VIEWS)[number]>('Heute')
  const [pv, setPv] = useState<(typeof PVIEWS)[number]>('Board')
  const t = today(), tm = addDays(t, 1), w = addDays(t, 7)
  const open = db.tasks.filter(x => !x.done)
  const lists: Record<string, typeof open> = {
    'Eingang': open.filter(x => !x.due && !x.projectId),
    Heute: open.filter(x => x.due && x.due <= t),
    Morgen: open.filter(x => x.due === tm),
    'Nächste 7 Tage': open.filter(x => x.due && x.due <= w),
    'Später': open.filter(x => !x.due || x.due > w),
    'Alle': db.tasks,
    Erledigt: db.tasks.filter(x => x.done),
  }
  const defaults: Record<string, string | undefined> = { Heute: t, Morgen: tm, 'Nächste 7 Tage': t }

  return (
    <>
      <PageHeader icon="☑️" title="Tasks" cover="todo" />
      <Section title="Tasks" icon="👁️" actions={<button className="chip" onClick={() => ed.createTask({ due: defaults[v] })}>+ Task</button>}>
        <Tabs tabs={VIEWS} value={v} onChange={setV} />
        {v === 'Nach Priorität' ? (
          <div className="prio-groups">
            {PRIORITIES.map(p => {
              const list = open.filter(x => x.priority === p)
              return (
                <div key={p || 'none'} className="prio-group">
                  <div className="prio-head"><Pill tone={statusTone[p] || 'gray'}>{p ? tr(p) : tr('Ohne Priority')}</Pill><span className="muted">{list.length}</span></div>
                  {list.length > 0 && <TaskList tasks={list} />}
                </div>
              )
            })}
          </div>
        ) : v === 'Zeitleiste' ? <Timeline /> : <TaskList tasks={lists[v]} />}
      </Section>

      <Section title="Projects" icon="🏗️">
        <Tabs tabs={PVIEWS} value={pv} onChange={setPv} />
        {pv === 'Board' && <ProjectBoard projects={db.projects.filter(p => !p.archived)} />}
        {pv === 'Tabelle' && <ProjectTable projects={db.projects.filter(p => !p.archived)} />}
        {pv === 'Archiv' && <ProjectTable projects={db.projects.filter(p => p.archived)} />}
      </Section>

      <Section title="Kalender" icon="📅"><TaskCalendar /></Section>
    </>
  )
}

function TaskCalendar() {
  const { db, patch } = useStore()
  const ed = useEditor()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const first = new Date(month)
  const offset = (first.getDay() + 6) % 7
  const start = isoDate(new Date(first.getFullYear(), first.getMonth(), 1 - offset))
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const t = today()
  const [drag, setDrag] = useState<string | null>(null)
  return (
    <div className="calendar">
      <div className="cal-head">
        <strong>{month.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</strong>
        <span className="pager">
          <button className="chip" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <button className="chip" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>{tr('Heute')}</button>
          <button className="chip" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </span>
      </div>
      <div className="cal-grid">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <div key={d} className="cal-wd">{tr(d)}</div>)}
        {days.map(d => {
          const inMonth = parseDate(d).getMonth() === month.getMonth()
          const tasks = db.tasks.filter(x => x.due === d)
          return (
            <div key={d} className={`cal-day ${inMonth ? '' : 'out'} ${d === t ? 'today' : ''}`}
              onDoubleClick={() => ed.createTask({ due: d })}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (drag) patch('tasks', drag, { due: d }); setDrag(null) }}>
              <span className="cal-num">{parseDate(d).getDate()}</span>
              {tasks.map(x => (
                <button key={x.id} draggable onDragStart={() => setDrag(x.id)}
                  className={`cal-task ${x.done ? 'is-done' : ''}`} onClick={() => ed.open('task', x.id)}>
                  {x.title || tr('Unbenannt')}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <p className="hint">{tr('Doppelklick auf einen Tag legt einen Task an. Tasks lassen sich per Drag & Drop verschieben.')}</p>
    </div>
  )
}

/** Timeline: offene Tasks der nächsten 14 Tage, eine Zeile pro Projekt (Überfälliges in der ersten Spalte) */
function Timeline() {
  const { db, patch } = useStore()
  const ed = useEditor()
  const [drag, setDrag] = useState<string | null>(null)
  const t = today()
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i))
  const last = days[days.length - 1]
  const open = db.tasks.filter(x => !x.done && x.due && x.due <= last)
  const rows = [
    ...db.projects.filter(p => !p.archived).map(p => ({ id: p.id, label: `${p.name || tr('Unbenannt')}` })),
    { id: '', label: tr('Ohne Projekt') },
  ].map(r => ({ ...r, tasks: open.filter(x => (x.projectId || '') === r.id) })).filter(r => r.tasks.length)
  const cellTasks = (tasks: typeof open, d: string, i: number) => tasks.filter(x => x.due === d || (i === 0 && x.due! < t))
  return (
    <>
      <div className="timeline" style={{ gridTemplateColumns: `minmax(150px, 1.4fr) repeat(14, minmax(84px, 1fr))` }}>
        <div className="tl-cell tl-head tl-label">{tr('Projekt')}</div>
        {days.map(d => (
          <div key={d} className={`tl-cell tl-head ${d === t ? 'today' : ''}`}>
            {parseDate(d).toLocaleDateString(locale(), { weekday: 'short' })}<br />{parseDate(d).getDate()}.{parseDate(d).getMonth() + 1}.
          </div>
        ))}
        {rows.map(r => [
          <div key={r.id + 'l'} className="tl-cell tl-label">{r.label}</div>,
          ...days.map((d, i) => (
            <div key={r.id + d} className={`tl-cell ${d === t ? 'today' : ''}`}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (drag) patch('tasks', drag, { due: d, projectId: r.id || undefined }); setDrag(null) }}>
              {cellTasks(r.tasks, d, i).map(x => (
                <button key={x.id} draggable onDragStart={() => setDrag(x.id)} onClick={() => ed.open('task', x.id)}
                  className={`cal-task ${x.due! < t ? 'overdue' : ''}`}>{x.title || tr('Unbenannt')}</button>
              ))}
            </div>
          )),
        ])}
      </div>
      {!rows.length && <p className="muted">{tr('Keine offenen Tasks mit Datum in den nächsten 14 Tagen.')}</p>}
      <p className="hint">{tr('Tasks per Drag & Drop auf einen anderen Tag oder in ein anderes Projekt ziehen. Überfällige Tasks stehen rot in der ersten Spalte.')}</p>
    </>
  )
}

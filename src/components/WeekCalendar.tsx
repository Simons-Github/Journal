import { useState } from 'react'
import { useStore } from '../store'
import { addDays, parseDate, today } from '../utils'
import { useEditor } from './Editor'
import { locale, t as tr } from '../i18n'

/**
 * Kalender der Tasks über 7 Tage ab `start` (wie der „Kalender“-Block im Template-Tag).
 * Überfällige, offene Tasks erscheinen in der ersten Spalte. Doppelklick legt einen Task an,
 * Tasks lassen sich per Drag & Drop auf einen anderen Tag verschieben.
 */
export function WeekCalendar({ start }: { start: string }) {
  const { db, patch } = useStore()
  const ed = useEditor()
  const [drag, setDrag] = useState<string | null>(null)
  const t = today()
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="week-cal">
      {days.map((d, i) => {
        const tasks = db.tasks.filter(x => x.due === d || (i === 0 && !x.done && x.due && x.due < d))
        return (
          <div key={d} className={`week-day ${d === t ? 'today' : ''}`}
            onDoubleClick={() => ed.createTask({ due: d })}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (drag) patch('tasks', drag, { due: d }); setDrag(null) }}>
            <div className="week-day-head">
              <span>{parseDate(d).toLocaleDateString(locale(), { weekday: 'short' })}</span>
              <span className="cal-num">{parseDate(d).getDate()}</span>
            </div>
            {tasks.map(x => (
              <button key={x.id} draggable onDragStart={() => setDrag(x.id)} onClick={() => ed.open('task', x.id)}
                className={`cal-task ${x.done ? 'is-done' : ''} ${x.due && x.due < d ? 'overdue' : ''}`}>
                {x.title || tr('Unbenannt')}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

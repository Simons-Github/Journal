import { useState } from 'react'
import { Note, useStore } from '../store'
import { REVIEW_STEPS, addDays, dueLabel, fmtDate, isoDate, parseDate, today, uid } from '../utils'
import { useEditor } from '../components/Editor'
import { CourseImportButton } from '../components/CourseImport'
import { GoalsByArea, ProjectBoard } from '../components/Boards'
import { AddRow, Empty, PageHeader, Section, Stars, Tabs } from '../components/ui'
import { locale, t as tr } from '../i18n'

const SLOTS = ['8:00 – 8:45', '8:50 – 9:35', '9:50 – 10:35', '10:40 – 11:25', '11:45 – 12:30', '12:35 – 13:20', '13:50 – 14:35', '14:35 – 15:20', '15:25 – 16:10', '16:10 – 16:55']
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag']
const VIEWS = ['Alle', 'Heute fällig', 'Kalender', 'Morgen fällig', 'Nach Bewertung'] as const

export default function School() {
  const { db, add, patch, update } = useStore()
  const ed = useEditor()
  const [v, setV] = useState<(typeof VIEWS)[number]>('Alle')
  const area = db.areas.find(a => /schule|school/.test(a.name.toLowerCase())) || db.areas[0]
  const subjects = db.resources.filter(r => r.areaId === area?.id)
  const notes = db.notes.filter(n => n.areaId === area?.id && !n.archived)
  const t = today()

  const groups = [{ id: '', icon: '', name: tr('Ohne Resource / Fach') }, ...subjects]
    .map(s => ({ ...s, items: notes.filter(n => (n.resourceId || '') === s.id) }))
    .filter(g => g.id || g.items.length)

  const view = (items: typeof notes) => {
    if (v === 'Heute fällig') items = items.filter(n => n.nextReview && n.nextReview <= t)
    if (v === 'Morgen fällig') items = items.filter(n => n.nextReview === addDays(t, 1))
    if (v === 'Nach Bewertung') items = [...items].sort((a, b) => b.rating - a.rating)
    return items
  }

  return (
    <>
      <PageHeader icon="🎓" title="Study" cover="school" />

      <Section title="Fächer" icon="🏷️" actions={<CourseImportButton />}>
        <div className="gallery">
          {subjects.map(s => (
            <button key={s.id} className="gallery-card" onClick={() => ed.open('resource', s.id)}>
              <div className="area-icon">{s.icon}</div><div className="gc-title">{s.name}</div>
              <div className="muted small">{tr('{n} Notizen', { n: notes.filter(n => n.resourceId === s.id).length })}</div>
            </button>
          ))}
          <button className="gallery-card add-card" onClick={() => { const id = uid(); add('resources', { id, name: '', icon: '📘', areaId: area?.id }); ed.open('resource', id) }}>+ {tr('Neues Fach')}</button>
        </div>
      </Section>

      <Section title="Lernzettel & Wiederholung" icon="🗓️" actions={<button className="chip" onClick={() => ed.createNote({ type: 'Lernzettel/Mitschrift', areaId: area?.id, nextReview: t })}>+ {tr('Lernzettel')}</button>}>
        <Tabs tabs={VIEWS} value={v} onChange={setV} />
        {v === 'Heute fällig' && <p className="hint">{tr('Nur Notizen, die heute (oder früher) wiederholt werden sollten.')}</p>}
        {v === 'Morgen fällig' && <p className="hint">{tr('Was steht morgen zum Wiederholen an? Ideal für die Abendroutine, um den nächsten Lerntag vorzubereiten.')}</p>}
        {v === 'Kalender' && <ReviewCalendar notes={notes} />}
        {v !== 'Kalender' && groups.map(g => {
          const items = view(g.items)
          return (
            <div key={g.id || 'none'} className="res-group">
              <div className="res-group-head">{g.icon} {g.name} <span className="muted">{items.length}</span></div>
              {items.length ? (
                <div className="table-wrap">
                  <table className="db-table">
                    <thead><tr><th>Name</th><th>{tr('Bewertung')}</th><th>{tr('Nächstes Lernen')}</th><th>{tr('x Male wiederholt')}</th><th></th></tr></thead>
                    <tbody>
                      {items.map(n => (
                        <tr key={n.id} onClick={() => ed.open('note', n.id)}>
                          <td className="strong">{n.title || tr('Unbenannt')}</td>
                          <td><Stars value={n.rating} onChange={rating => patch('notes', n.id, { rating })} /></td>
                          <td className={n.nextReview && n.nextReview <= t ? 'overdue' : ''}>{n.nextReview ? dueLabel(n.nextReview) : '–'}</td>
                          <td>{n.reviewCount}</td>
                          <td><button className="chip" onClick={e => {
                            e.stopPropagation()
                            patch('notes', n.id, { reviewCount: n.reviewCount + 1, nextReview: addDays(t, REVIEW_STEPS[Math.min(n.reviewCount, REVIEW_STEPS.length - 1)]) })
                          }}>{tr('Wiederholt')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>Keine Notizen</Empty>}
            </div>
          )
        })}
      </Section>

      <Section title="Projects" icon="🏗️"><ProjectBoard projects={db.projects.filter(p => p.areaId === area?.id && !p.archived)} areaId={area?.id} /></Section>
      <Section title="Goals" icon="🏆"><GoalsByArea areaId={area?.id} /></Section>

      <Section title="Stundenplan" icon="🍁">
        <div className="table-wrap">
          <table className="timetable">
            <thead><tr><th>{tr('Std.')}</th><th>{tr('Uhrzeit')}</th>{DAYS.map(d => <th key={d}>{tr(d)}</th>)}</tr></thead>
            <tbody>
              {SLOTS.map((s, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td><td className="muted nowrap">{s}</td>
                  {DAYS.map((_, j) => (
                    <td key={j}><input value={db.timetable[i]?.[j] || ''} onChange={e => update(d => {
                      d.timetable[i] = d.timetable[i] || ['', '', '', '', '']
                      d.timetable[i][j] = e.target.value
                    })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="muted small">{tr('Stand: {date}', { date: fmtDate(t) })}</p>
      <AddRow onClick={() => ed.createNote({ type: 'Lernzettel/Mitschrift', areaId: area?.id, nextReview: t })}>Neuer Lernzettel</AddRow>
    </>
  )
}

/** Monatskalender der Lernzettel nach „Nächstes Lernen“; per Drag & Drop umplanen */
function ReviewCalendar({ notes }: { notes: Note[] }) {
  const { patch } = useStore()
  const ed = useEditor()
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [drag, setDrag] = useState<string | null>(null)
  const offset = (month.getDay() + 6) % 7
  const start = isoDate(new Date(month.getFullYear(), month.getMonth(), 1 - offset))
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const t = today()
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
        {days.map(d => (
          <div key={d} className={`cal-day ${parseDate(d).getMonth() === month.getMonth() ? '' : 'out'} ${d === t ? 'today' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (drag) patch('notes', drag, { nextReview: d }); setDrag(null) }}>
            <span className="cal-num">{parseDate(d).getDate()}</span>
            {notes.filter(n => n.nextReview === d).map(n => (
              <button key={n.id} draggable onDragStart={() => setDrag(n.id)} className={`cal-task ${d < t ? 'overdue' : ''}`} onClick={() => ed.open('note', n.id)}>
                {n.title || tr('Unbenannt')}
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="hint">{tr('Lernzettel lassen sich per Drag & Drop auf einen anderen Tag verschieben.')}</p>
    </div>
  )
}

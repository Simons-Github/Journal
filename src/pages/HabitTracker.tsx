import { useState } from 'react'
import { useStore } from '../store'
import { addDays, fmtDate, startOfWeek, today, uid } from '../utils'
import { useEditor } from '../components/Editor'
import { HabitChart, HabitChecklist, HabitWeekGrid } from '../components/Habits'
import { AddRow, PageHeader, Section } from '../components/ui'
import { t } from '../i18n'

const days = (n: number) => `${n} ${n === 1 ? t('Tag') : t('Tage')}`

export default function HabitTracker() {
  const { db, add } = useStore()
  const ed = useEditor()
  const [ws, setWs] = useState(startOfWeek(today()))
  const create = (kind: 'good' | 'bad') => {
    const id = uid()
    add('habits', { id, name: '', icon: kind === 'good' ? '✨' : '🚫', kind })
    ed.open('habit', id)
  }
  const streak = (id: string) => {
    let n = 0, d = today()
    if (!(db.habitLog[d] || []).includes(id)) d = addDays(d, -1)
    while ((db.habitLog[d] || []).includes(id)) { n++; d = addDays(d, -1) }
    return n
  }
  return (
    <>
      <PageHeader icon="✅" title="Habit Tracker" cover="habits" />
      <div className="grid-2">
        <Section title="Aufbauen" icon="🌱">
          <div className="list">
            {db.habits.filter(h => h.kind === 'good' && !h.archived).map(h => (
              <button key={h.id} className="list-row" onClick={() => ed.open('habit', h.id)}>
                <span>{h.icon} {h.name || t('Unbenannt')}</span><span className="muted small">{days(streak(h.id))}</span>
              </button>
            ))}
          </div>
          <AddRow onClick={() => create('good')}>Neue Gewohnheit aufbauen</AddRow>
        </Section>
        <Section title="Loswerden" icon="🥀">
          <div className="list">
            {db.habits.filter(h => h.kind === 'bad' && !h.archived).map(h => (
              <button key={h.id} className="list-row" onClick={() => ed.open('habit', h.id)}>
                <span>{h.icon} {h.name || t('Unbenannt')}</span><span className="muted small">{days(streak(h.id))} {t('in Folge passiert')}</span>
              </button>
            ))}
          </div>
          <AddRow onClick={() => create('bad')}>Schlechte Gewohnheit loswerden</AddRow>
        </Section>
      </div>
      <div className="dash-top">
        <Section title="Heute" icon="☑️"><HabitChecklist date={today()} /></Section>
        <Section title="Letzte 30 Tage" icon="📈" className="chart-card"><HabitChart days={30} /></Section>
      </div>
      <Section title="Woche im Überblick" icon="🗓️" actions={
        <span className="pager">
          <button className="chip" onClick={() => setWs(addDays(ws, -7))}>‹</button>
          <button className="chip" onClick={() => setWs(startOfWeek(today()))}>{t('Heute')}</button>
          <button className="chip" onClick={() => setWs(addDays(ws, 7))}>›</button>
        </span>}>
        <p className="hint">{fmtDate(ws)} – {fmtDate(addDays(ws, 6))}</p>
        <HabitWeekGrid weekStart={ws} />
      </Section>
    </>
  )
}

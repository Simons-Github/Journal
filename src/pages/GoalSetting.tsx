import { useState } from 'react'
import { goalProgress, useStore } from '../store'
import { addDays, diffDays, fmtDate, fmtShort, today } from '../utils'
import { useEditor } from '../components/Editor'
import { GoalsByArea, ProjectCard } from '../components/Boards'
import { AddRow, AutoText, PageHeader, Progress, Section, Tabs } from '../components/ui'
import { t as tr } from '../i18n'

export default function GoalSetting() {
  const { db, update } = useStore()
  const ed = useEditor()
  const [view, setView] = useState<'Aktiv' | 'Erreicht'>('Aktiv')
  const t = today()
  const start = db.cycleStart
  const end = addDays(start, 83)
  const curWeek = Math.floor(diffDays(t, start) / 7) + 1
  const cycleGoals = db.goals.filter(g => !g.done && (!g.deadline || g.deadline <= end))

  return (
    <>
      <PageHeader icon="🎯" title="Goals" cover="goal" />

      <Section title="Dein 12-Wochen-Jahr" icon="📆" actions={
        <label className="small muted">{tr('Start')}&nbsp;
          <input type="date" value={start} onChange={e => update(d => { d.cycleStart = e.target.value })} />
        </label>}>
        <p className="hint">{tr('Dein Jahr hat 12 Wochen.')} {fmtDate(start)} – {fmtDate(end)}{curWeek >= 1 && curWeek <= 12 ? ` · ${tr('Du bist in Woche {n}.', { n: curWeek })}` : ''}</p>
        <div className="weeks12">
          {Array.from({ length: 12 }, (_, i) => {
            const ws = addDays(start, i * 7)
            const cls = i + 1 < curWeek ? 'past' : i + 1 === curWeek ? 'now' : ''
            return <div key={i} className={`wk ${cls}`}><b>{tr('W')}{i + 1}</b><span>{fmtShort(ws)}</span></div>
          })}
        </div>
        <div className="list">
          {cycleGoals.map(g => (
            <button key={g.id} className="list-row" onClick={() => ed.open('goal', g.id)}>
              <span>{g.title || tr('Unbenannt')}</span><Progress value={goalProgress(db, g.id)} />
            </button>
          ))}
        </div>
        <AddRow onClick={() => ed.createGoal()}>Ziel für diesen Zyklus</AddRow>
      </Section>

      <Section title="Deine Geschichte" icon="📖">
        <div className="grid-2">
          <div>
            <h3 className="sub">{tr('Anti-Vision: So soll es nicht werden')}</h3>
            <AutoText minRows={6} value={db.antiVision} onChange={v => update(d => { d.antiVision = v })} />
          </div>
          <div>
            <h3 className="sub">{tr('Vision: So soll es werden')}</h3>
            <AutoText minRows={6} value={db.visionBoard} onChange={v => update(d => { d.visionBoard = v })} />
          </div>
        </div>
      </Section>

      <Section title="Goals nach Area" icon="🗂️">
        <Tabs tabs={['Aktiv', 'Erreicht'] as const} value={view} onChange={setView} />
        {view === 'Aktiv' ? <GoalsByArea /> : (
          <div className="list">
            {db.goals.filter(g => g.done).map(g => (
              <button key={g.id} className="list-row is-done" onClick={() => ed.open('goal', g.id)}>{g.title}</button>
            ))}
            {!db.goals.some(g => g.done) && <p className="muted">{tr('Noch keine erreichten Ziele.')}</p>}
          </div>
        )}
      </Section>

      <Section title="Projects nach Goal" icon="🏗️">
        <div className="board">
          {[{ id: '', title: tr('Ohne Ziele') }, ...db.goals.filter(g => !g.done)].map(g => {
            const ps = db.projects.filter(p => !p.archived && (p.goalId || '') === g.id)
            return (
              <div key={g.id || 'none'} className="board-col">
                <div className="board-col-head"><span>{g.title || tr('Unbenannt')}</span><span className="muted">{ps.length}</span></div>
                {ps.map(p => <ProjectCard key={p.id} p={p} />)}
                <AddRow onClick={() => ed.createProject({ goalId: g.id || undefined })}>Neu</AddRow>
              </div>
            )
          })}
        </div>
      </Section>
    </>
  )
}

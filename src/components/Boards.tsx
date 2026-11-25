import { Project, STATUSES, goalProgress, projectStats, useStore } from '../store'
import { fmtDate } from '../utils'
import { useEditor } from './Editor'
import { AddRow, Empty, Pill, Progress, statusTone } from './ui'
import { t } from '../i18n'

export function ProjectCard({ p }: { p: Project }) {
  const { db } = useStore()
  const ed = useEditor()
  const st = projectStats(db, p.id)
  const area = db.areas.find(a => a.id === p.areaId)
  return (
    <button className="board-card" onClick={() => ed.open('project', p.id)}>
      <div className="bc-title">{p.name || t('Unbenannt')}</div>
      <div className="muted small">{st.total} Tasks, <span className={st.overdue ? 'overdue' : ''}>{st.overdue} Overdue</span></div>
      <Progress value={st.progress} />
      <div className="bc-tags">
        <Pill tone={statusTone[p.status]}>{p.status}</Pill>
        {area && <Pill>{area.icon} {area.name}</Pill>}
      </div>
    </button>
  )
}

/** Projekte als Kanban-Board nach Status */
export function ProjectBoard({ projects, areaId }: { projects: Project[]; areaId?: string }) {
  const ed = useEditor()
  return (
    <div className="board">
      {STATUSES.map(s => {
        const col = projects.filter(p => p.status === s)
        return (
          <div className="board-col" key={s}>
            <div className="board-col-head"><Pill tone={statusTone[s]}>{s}</Pill><span className="muted">{col.length}</span></div>
            {col.map(p => <ProjectCard key={p.id} p={p} />)}
            <AddRow onClick={() => ed.createProject({ status: s, areaId })}>Neu</AddRow>
          </div>
        )
      })}
    </div>
  )
}

export function ProjectTable({ projects }: { projects: Project[] }) {
  const { db } = useStore()
  const ed = useEditor()
  if (!projects.length) return <Empty>Keine Projekte</Empty>
  return (
    <div className="table-wrap">
      <table className="db-table">
        <thead><tr><th>Name</th><th>Status</th><th>Area</th><th>Meta</th><th>Progress</th></tr></thead>
        <tbody>
          {projects.map(p => {
            const st = projectStats(db, p.id)
            const area = db.areas.find(a => a.id === p.areaId)
            return (
              <tr key={p.id} onClick={() => ed.open('project', p.id)}>
                <td className="strong">{p.name || t('Unbenannt')}</td>
                <td><Pill tone={statusTone[p.status]}>{p.status}</Pill></td>
                <td>{area ? `${area.icon} ${area.name}` : ''}</td>
                <td className="muted">{st.total} Tasks, {st.overdue} Overdue</td>
                <td><Progress value={st.progress} /></td>
              </tr>
            )
          })}
        </tbody>
        <tfoot><tr><td colSpan={5} className="muted">{t('ANZAHL')} {projects.length}</td></tr></tfoot>
      </table>
    </div>
  )
}

/** Ziele gruppiert nach Area */
export function GoalsByArea({ showDone = false, areaId }: { showDone?: boolean; areaId?: string }) {
  const { db } = useStore()
  const ed = useEditor()
  const goals = db.goals.filter(g => (showDone || !g.done) && (!areaId || g.areaId === areaId))
  const groups = [
    ...db.areas.filter(a => !areaId || a.id === areaId).map(a => ({ key: a.id, label: `${a.icon} ${a.name}`, items: goals.filter(g => g.areaId === a.id) })),
    ...(areaId ? [] : [{ key: 'none', label: t('Ohne Area'), items: goals.filter(g => !g.areaId) }]),
  ].filter(g => g.items.length)
  return (
    <div className="board">
      {groups.map(g => (
        <div className="board-col" key={g.key}>
          <div className="board-col-head"><span>{g.label}</span><span className="muted">{g.items.length}</span></div>
          {g.items.map(goal => (
            <button key={goal.id} className={`board-card ${goal.done ? 'is-done' : ''}`} onClick={() => ed.open('goal', goal.id)}>
              <div className="bc-title">{goal.title || t('Unbenannt')}</div>
              {goal.deadline && <div className="muted small">{t('bis {date}', { date: fmtDate(goal.deadline) })}</div>}
              <Progress value={goalProgress(db, goal.id)} />
            </button>
          ))}
        </div>
      ))}
      <div className="board-col">
        <AddRow onClick={() => ed.createGoal({ areaId })}>Neues Ziel</AddRow>
      </div>
    </div>
  )
}

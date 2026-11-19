import { Task, useStore } from '../store'
import { dueLabel, today } from '../utils'
import { useEditor } from './Editor'
import { Check, Empty, Pill, statusTone } from './ui'
import { t as tr } from '../i18n'

export function TaskList({ tasks, showProject = true, empty = 'Keine Tasks 🎉' }: { tasks: Task[]; showProject?: boolean; empty?: string }) {
  const { db, patch } = useStore()
  const ed = useEditor()
  if (!tasks.length) return <Empty>{tr(empty)}</Empty>
  const sorted = [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'))
  return (
    <ul className="task-list">
      {sorted.map(t => {
        const project = showProject && t.projectId ? db.projects.find(p => p.id === t.projectId) : undefined
        const overdue = !t.done && t.due && t.due < today()
        return (
          <li key={t.id} className="task-row">
            <Check checked={t.done} onChange={done => patch('tasks', t.id, { done, doneAt: done ? new Date().toISOString() : undefined })} />
            <button className={`task-title ${t.done ? 'is-done' : ''}`} onClick={() => ed.open('task', t.id)}>
              {t.title || <span className="muted">{tr('Unbenannt')}</span>}
            </button>
            <span className="task-meta">
              {project && <span className="muted small">{project.name}</span>}
              {t.priority && <Pill tone={statusTone[t.priority]}>{tr(t.priority)}</Pill>}
              {t.due && <span className={`due ${overdue ? 'overdue' : ''}`}>{dueLabel(t.due)}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

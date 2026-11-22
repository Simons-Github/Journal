import { useState } from 'react'
import { Check as CheckIcon, ListChecks } from 'lucide-react'
import type { AiProposal } from '../api'
import { PRIORITIES, Priority, newTask, useStore } from '../store'
import { useEditor } from './Editor'
import { t } from '../i18n'
import { uid } from '../utils'

/** Was aus einem Vorschlag geworden ist (wird mit dem Chat gespeichert) */
export type ProposalResult = { status: 'added'; count: number; projectId?: string; projectName?: string } | { status: 'dismissed' }

interface Row { on: boolean; title: string; due: string; priority: Priority }

const NONE = ''
const NEW = '__new__'

/**
 * Vorschlag des Assistenten für neue Tasks: abwählen, bearbeiten, Projekt wählen, übernehmen.
 * Erst „Übernehmen“ legt Tasks (und ggf. das neue Projekt) im Workspace an.
 */
export function ProposalCard({ proposal, result, disabled, onResolve }: {
  proposal: AiProposal
  result?: ProposalResult
  disabled?: boolean
  onResolve: (r: ProposalResult) => void
}) {
  const { db, update } = useStore()
  const ed = useEditor()
  const [rows, setRows] = useState<Row[]>(() => proposal.tasks.map(x => ({ on: true, title: x.title, due: x.due ?? '', priority: x.priority })))
  const p = proposal.project
  const [project, setProject] = useState(() => (!p ? NONE : 'newName' in p ? NEW : p.id))
  const [newName, setNewName] = useState(p && 'newName' in p ? p.newName : '')

  if (result?.status === 'added') {
    return (
      <div className="ai-card done">
        <CheckIcon size={16} strokeWidth={2.2} />
        <span>{t(result.count === 1 ? '1 Task hinzugefügt' : '{n} Tasks hinzugefügt', { n: result.count })}{result.projectName ? ` · ${result.projectName}` : ''}</span>
        {result.projectId && db.projects.some(x => x.id === result.projectId) && (
          <button className="ai-link" onClick={() => ed.open('project', result.projectId!)}>{t('Projekt öffnen')}</button>
        )}
      </div>
    )
  }
  if (result?.status === 'dismissed') {
    return <div className="ai-card done muted"><span>{t('Vorschlag verworfen')}</span></div>
  }

  const projects = db.projects.filter(x => !x.archived && x.status !== 'Done')
  const chosen = rows.filter(r => r.on && r.title.trim())
  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  function accept() {
    if (!chosen.length) return
    let projectId: string | undefined
    let projectName: string | undefined
    if (project === NEW && newName.trim()) {
      projectId = uid(); projectName = newName.trim()
    } else if (project !== NONE && project !== NEW) {
      projectId = project; projectName = db.projects.find(x => x.id === project)?.name
    }
    const tasks = chosen.map(r => newTask({ title: r.title.trim(), due: r.due || undefined, priority: r.priority, projectId }))
    update(d => {
      if (project === NEW && projectId) d.projects.unshift({ id: projectId, name: projectName!, status: 'To Do' })
      d.tasks.unshift(...tasks)
    })
    onResolve({ status: 'added', count: tasks.length, projectId, projectName })
  }

  return (
    <div className="ai-card">
      <div className="ai-card-head"><ListChecks size={16} strokeWidth={2} />{t('Vorgeschlagene Tasks')}</div>
      <ul className="ai-rows">
        {rows.map((r, i) => (
          <li key={i} className={r.on ? '' : 'off'}>
            <input type="checkbox" checked={r.on} onChange={e => set(i, { on: e.target.checked })} aria-label={t('Übernehmen')} />
            <div className="ai-row-main">
              <input className="ai-row-title" value={r.title} onChange={e => set(i, { title: e.target.value })} aria-label={t('Titel')} />
              <div className="ai-row-meta">
                <input type="date" value={r.due} onChange={e => set(i, { due: e.target.value })} aria-label={t('Fällig')} />
                <select value={r.priority} onChange={e => set(i, { priority: e.target.value as Priority })} aria-label={t('Priorität')}>
                  {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr ? t(pr) : t('Ohne Priority')}</option>)}
                </select>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="ai-card-project">
        <select value={project} onChange={e => setProject(e.target.value)} aria-label={t('Projekt')}>
          <option value={NONE}>{t('Ohne Projekt')}</option>
          {(p && 'newName' in p || project === NEW) && <option value={NEW}>{t('Neues Projekt')}</option>}
          {projects.map(x => <option key={x.id} value={x.id}>{x.name || t('(ohne Titel)')}</option>)}
        </select>
        {project === NEW && <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('Name des Projekts')} aria-label={t('Name des Projekts')} />}
      </div>
      <div className="ai-card-actions">
        <button className="btn primary" onClick={accept} disabled={disabled || !chosen.length || (project === NEW && !newName.trim())}>
          {t(chosen.length === 1 ? '1 Task übernehmen' : '{n} Tasks übernehmen', { n: chosen.length })}
        </button>
        <button className="btn danger" onClick={() => onResolve({ status: 'dismissed' })} disabled={disabled}>{t('Verwerfen')}</button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useStore } from '../store'
import { useEditor } from '../components/Editor'
import { ProjectBoard, ProjectTable } from '../components/Boards'
import { PageHeader, Section, Tabs } from '../components/ui'
import { t } from '../i18n'

const VIEWS = ['Nach Status', 'Nach Bereich', 'Archiv'] as const

export default function ProjectHub() {
  const { db } = useStore()
  const ed = useEditor()
  const [v, setV] = useState<(typeof VIEWS)[number]>('Nach Status')
  const active = db.projects.filter(p => !p.archived)
  return (
    <>
      <PageHeader icon="🏗️" title="Projects" cover="projects" />
      <Section title="Übersicht" icon="📋" actions={<button className="chip" onClick={() => ed.createProject()}>+ {t('Projekt')}</button>}>
        <Tabs tabs={VIEWS} value={v} onChange={setV} />
        {v === 'Nach Status' && <ProjectBoard projects={active} />}
        {v === 'Nach Bereich' && [{ id: '', icon: '', name: t('Ohne Area') }, ...db.areas].map(a => {
          const ps = active.filter(p => (p.areaId || '') === a.id)
          if (!ps.length) return null
          return (
            <div key={a.id || 'none'} className="res-group">
              <div className="res-group-head">{a.icon} {a.name} <span className="muted">{ps.length}</span></div>
              <ProjectTable projects={ps} />
            </div>
          )
        })}
        {v === 'Archiv' && <ProjectTable projects={db.projects.filter(p => p.archived)} />}
      </Section>
      <Section title="All Projects" icon="🗃️">
        <ProjectTable projects={active} />
      </Section>
    </>
  )
}

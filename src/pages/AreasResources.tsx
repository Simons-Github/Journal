import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../store'
import { uid } from '../utils'
import { useEditor } from '../components/Editor'
import { GoalsByArea, ProjectBoard } from '../components/Boards'
import { NoteList } from './NotesManager'
import { AddRow, Empty, PageHeader, Section } from '../components/ui'
import { t as tr } from '../i18n'

export default function AreasResources() {
  const { db, add } = useStore()
  const ed = useEditor()
  const [showArchive, setShowArchive] = useState(false)
  const areas = db.areas.filter(a => !!a.archived === showArchive)
  const groups = [
    { id: '', name: tr('Ohne Root Area'), icon: '' },
    ...db.areas.filter(a => !a.archived),
  ].map(a => ({ ...a, items: db.resources.filter(r => (r.areaId || '') === a.id) })).filter(g => g.items.length)

  return (
    <>
      <PageHeader icon="🗄️" title="Areas" cover="areas" />

      <Section title="Areas" icon="🧭" actions={<button className="chip" onClick={() => setShowArchive(s => !s)}>{showArchive ? tr('Aktive Areas') : tr('Areas Archiv')}</button>}>
        <div className="gallery">
          {areas.map(a => (
            <Link key={a.id} to={`/area/${a.id}`} className="gallery-card area-card">
              <div className="area-icon">{a.icon}</div>
              <div className="gc-title">{a.name}</div>
              <div className="muted small">
                {tr('{n} Ziele', { n: db.goals.filter(g => g.areaId === a.id && !g.done).length })} · {tr('{n} Projekte', { n: db.projects.filter(p => p.areaId === a.id && !p.archived).length })} · {tr('{n} Notizen', { n: db.notes.filter(n => n.areaId === a.id).length })}
              </div>
            </Link>
          ))}
          {!showArchive && (
            <button className="gallery-card add-card" onClick={() => { const id = uid(); add('areas', { id, name: '', icon: '📁' }); ed.open('area', id) }}>+ {tr('Neuer Bereich')}</button>
          )}
        </div>
      </Section>

      <Section title="Resources" icon="📚">
        {groups.map(g => (
          <div key={g.id || 'none'} className="res-group">
            <div className="res-group-head">{g.icon} {g.name} <span className="muted">{g.items.length}</span></div>
            <div className="list">
              {g.items.map(r => (
                <button key={r.id} className="list-row" onClick={() => ed.open('resource', r.id)}>
                  <span>{r.icon} {r.name}</span>
                  <span className="muted small">{tr('{n} Notizen', { n: db.notes.filter(n => n.resourceId === r.id).length })}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <AddRow onClick={() => { const id = uid(); add('resources', { id, name: '', icon: '📄' }); ed.open('resource', id) }}>Neue Resource</AddRow>
      </Section>
    </>
  )
}

export function AreaPage() {
  const { id } = useParams()
  const { db } = useStore()
  const ed = useEditor()
  const a = db.areas.find(x => x.id === id)
  if (!a) return <Empty>Area nicht gefunden.</Empty>
  const resources = db.resources.filter(r => r.areaId === a.id)
  return (
    <>
      <PageHeader icon={a.icon} title={a.name || tr('Unbenannt')} cover="areas">
        <button className="chip" onClick={() => ed.open('area', a.id)}>{tr('Area bearbeiten')}</button>
      </PageHeader>
      <Section title="Resources" icon="📚">
        <div className="gallery">
          {resources.map(r => (
            <button key={r.id} className="gallery-card" onClick={() => ed.open('resource', r.id)}>
              <div className="area-icon">{r.icon}</div><div className="gc-title">{r.name}</div>
            </button>
          ))}
          {!resources.length && <p className="muted">{tr('Keine Resources in dieser Area.')}</p>}
        </div>
      </Section>
      <Section title="Goals" icon="🏆"><GoalsByArea areaId={a.id} /></Section>
      <Section title="Projects" icon="🏗️"><ProjectBoard projects={db.projects.filter(p => p.areaId === a.id && !p.archived)} areaId={a.id} /></Section>
      <Section title="Notes" icon="📝" actions={<button className="chip" onClick={() => ed.createNote({ areaId: a.id })}>+ {tr('Notiz')}</button>}>
        <NoteList notes={db.notes.filter(n => n.areaId === a.id && !n.archived)} />
      </Section>
    </>
  )
}

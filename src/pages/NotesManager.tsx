import { useState } from 'react'
import { Note, useStore } from '../store'
import { fmtDate } from '../utils'
import { useEditor } from '../components/Editor'
import { Empty, PageHeader, Pill, Section, Tabs } from '../components/ui'
import { t } from '../i18n'

const typeIcon: Record<string, string> = {
  'Buch Notiz': '📕', 'Lernzettel/Mitschrift': '🧾', Podcast: '🎧', Zitat: '💬', 'Web-Artikel': '🌐', Idee: '💡', Notiz: '📄',
}

export function NoteList({ notes, empty = 'Keine Notizen' }: { notes: Note[]; empty?: string }) {
  const { db } = useStore()
  const ed = useEditor()
  if (!notes.length) return <Empty>{empty}</Empty>
  return (
    <div className="list">
      {notes.map(n => {
        const r = db.resources.find(x => x.id === n.resourceId)
        return (
          <button key={n.id} className="list-row" onClick={() => ed.open('note', n.id)}>
            <span>{typeIcon[n.type] || '📄'} {n.title || t('Unbenannt')} {n.favorite && '⭐'}</span>
            <span className="row-meta">
              {r && <Pill>{r.icon} {r.name}</Pill>}
              <span className="muted small">{fmtDate(n.updatedAt.slice(0, 10), { day: 'numeric', month: 'short' })}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function NotesManager() {
  const { db } = useStore()
  const ed = useEditor()
  const [tab, setTab] = useState<'Areas' | 'Resources'>('Areas')
  const [q, setQ] = useState('')
  const live = db.notes.filter(n => !n.archived)
  const inbox = live.filter(n => !n.areaId && !n.resourceId)
  const recent = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10)
  const search = q.trim().toLowerCase()
  const found = search ? live.filter(n => (n.title + ' ' + n.content).toLowerCase().includes(search)) : []

  return (
    <>
      <PageHeader icon="📝" title="Notes" cover="notes" />
      <div className="toolbar">
        <button className="btn primary" onClick={() => ed.createNote()}>{t('Neue Notiz')}</button>
        <input className="search" placeholder={t('Notizen durchsuchen …')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {search && <Section title="Suchergebnisse" icon="🔎"><NoteList notes={found} empty="Nichts gefunden" /></Section>}
      <div className="grid-2">
        <Section title="Eingang" icon="📥"><NoteList notes={inbox} empty="Inbox ist leer 🎉" /></Section>
        <Section title="Nach Area" icon="🗄️">
          <Tabs tabs={['Areas', 'Resources'] as const} value={tab} onChange={setTab} />
          <div className="list">
            {(tab === 'Areas' ? db.areas.filter(a => !a.archived) : db.resources).map(x => {
              const count = live.filter(n => (tab === 'Areas' ? n.areaId : n.resourceId) === x.id).length
              return (
                <button key={x.id} className="list-row" onClick={() => ed.open(tab === 'Areas' ? 'area' : 'resource', x.id)}>
                  <span>{x.icon} {x.name}</span><span className="muted small">{t('{n} Notizen', { n: count })}</span>
                </button>
              )
            })}
          </div>
        </Section>
      </div>
      <div className="grid-2">
        <Section title="Zuletzt bearbeitet" icon="🕒"><NoteList notes={recent} /></Section>
        <Section title="Favoriten" icon="⭐"><NoteList notes={live.filter(n => n.favorite)} empty="Noch keine Favoriten" /></Section>
      </div>
      <Section title="Archiv" icon="🗃️"><NoteList notes={db.notes.filter(n => n.archived)} empty="Archiv ist leer" /></Section>
    </>
  )
}

import { useState } from 'react'
import { useStore } from '../store'
import { uid } from '../utils'
import { AutoText, PageHeader } from '../components/ui'
import { t } from '../i18n'

export default function BrainFog() {
  const { db, add, patch, remove } = useStore()
  const [sel, setSel] = useState<string | undefined>(db.fog[0]?.id)
  const page = db.fog.find(p => p.id === sel) || db.fog[0]
  const create = () => {
    const id = uid()
    add('fog', { id, title: t('Seite {n}', { n: db.fog.length + 1 }), content: '', updatedAt: new Date().toISOString() })
    setSel(id)
  }
  return (
    <>
      <PageHeader icon="🌫️" title="Brain Dump" cover="fog" />
      <div className="fog">
        <div className="fog-list">
          {db.fog.map(p => (
            <button key={p.id} className={`fog-item ${p.id === page?.id ? 'active' : ''}`} onClick={() => setSel(p.id)}>
              {p.title || t('Unbenannt')}
            </button>
          ))}
          <button className="add-row" onClick={create}>+ {t('Neue Seite')}</button>
        </div>
        {page ? (
          <div className="fog-page card">
            <input className="modal-title" value={page.title} onChange={e => patch('fog', page.id, { title: e.target.value })} />
            <AutoText className="doc" minRows={14} value={page.content} placeholder={t('Schreib los …')} onChange={content => patch('fog', page.id, { content })} />
            <button className="btn danger ghost" onClick={() => { if (confirm(t('Seite löschen?'))) { remove('fog', page.id); setSel(undefined) } }}>{t('Seite löschen')}</button>
          </div>
        ) : <div className="fog-page card muted">{t('Lege eine neue Seite an.')}</div>}
      </div>
    </>
  )
}

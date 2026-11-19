import { useState } from 'react'
import { BookStatus, useStore } from '../store'
import { useEditor } from '../components/Editor'
import { AddRow, PageHeader, Pill, Section, Stars, Tabs, statusTone } from '../components/ui'
import { t } from '../i18n'

const VIEWS = ['Regal', 'Nach Status', 'Nach Bewertung', 'Tabelle'] as const
const STATUS: BookStatus[] = ['Idee', 'Am Lesen', 'Fertig']

export default function Books() {
  const { db, patch } = useStore()
  const ed = useEditor()
  const [v, setV] = useState<(typeof VIEWS)[number]>('Regal')
  const books = v === 'Nach Bewertung' ? [...db.books].sort((a, b) => b.rating - a.rating) : db.books

  const card = (b: typeof books[number]) => (
    <div key={b.id} role="button" tabIndex={0} className="gallery-card book" onClick={() => ed.open('book', b.id)}
      onKeyDown={e => { if (e.key === 'Enter') ed.open('book', b.id) }}>
      <div className={`book-cover status-${b.status === 'Fertig' ? 'done' : b.status === 'Am Lesen' ? 'reading' : 'idea'}`}><span>{b.title || t('Neues Buch')}</span></div>
      <div className="gc-title">{b.title || t('Unbenannt')}</div>
      <div className="muted small">{b.author}</div>
      <Stars value={b.rating} onChange={rating => patch('books', b.id, { rating })} />
      <Pill tone={statusTone[b.status]}>{t(b.status)}</Pill>
    </div>
  )

  return (
    <>
      <PageHeader icon="📕" title="Books" cover="books" />
      <Section title="Bibliothek" icon="📚" actions={<button className="chip" onClick={() => ed.createBook()}>+ {t('Buch')}</button>}>
        <Tabs tabs={VIEWS} value={v} onChange={setV} />
        {(v === 'Regal' || v === 'Nach Bewertung') && <div className="gallery">{books.map(card)}</div>}
        {v === 'Nach Status' && (
          <div className="board">
            {STATUS.map(s => (
              <div key={s} className="board-col">
                <div className="board-col-head"><Pill tone={statusTone[s]}>{t(s)}</Pill><span className="muted">{books.filter(b => b.status === s).length}</span></div>
                {books.filter(b => b.status === s).map(b => (
                  <button key={b.id} className="board-card" onClick={() => ed.open('book', b.id)}>
                    <div className="bc-title">{b.title || t('Unbenannt')}</div>
                    <Stars value={b.rating} />
                  </button>
                ))}
                <AddRow onClick={() => ed.createBook({ status: s })}>Neu</AddRow>
              </div>
            ))}
          </div>
        )}
        {v === 'Tabelle' && (
          <div className="table-wrap">
            <table className="db-table">
              <thead><tr><th>{t('Titel')}</th><th>{t('Autor')}</th><th>Status</th><th>{t('Bewertung')}</th></tr></thead>
              <tbody>
                {books.map(b => (
                  <tr key={b.id} onClick={() => ed.open('book', b.id)}>
                    <td className="strong">{b.title}</td><td>{b.author}</td>
                    <td><Pill tone={statusTone[b.status]}>{t(b.status)}</Pill></td>
                    <td><Stars value={b.rating} onChange={rating => patch('books', b.id, { rating })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}

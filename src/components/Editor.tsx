import { createContext, ReactNode, useCallback, useContext, useState } from 'react'
import { BookStatus, NOTE_TYPES, PRIORITIES, Priority, ProjectStatus, Routine, STATUSES, habitRoutine, newNote, newTask, projectStats, useStore } from '../store'
import { REVIEW_STEPS, addDays, today, uid } from '../utils'
import { AutoText, Check, Modal, Progress, Prop, Stars } from './ui'
import { TaskList } from './TaskList'
import { t as tr } from '../i18n'

type Kind = 'task' | 'note' | 'project' | 'goal' | 'book' | 'area' | 'resource' | 'habit'
type Open = { kind: Kind; id: string } | null

type EditorCtx = {
  open: (kind: Kind, id: string) => void
  createTask: (p?: Parameters<typeof newTask>[0]) => void
  createNote: (p?: Parameters<typeof newNote>[0]) => void
  createProject: (p?: { areaId?: string; goalId?: string; status?: ProjectStatus }) => void
  createGoal: (p?: { areaId?: string }) => void
  createBook: (p?: { status?: BookStatus }) => void
}
const Ctx = createContext<EditorCtx | null>(null)
export const useEditor = () => useContext(Ctx)!

export function EditorProvider({ children }: { children: ReactNode }) {
  const { add } = useStore()
  const [cur, setCur] = useState<Open>(null)
  const open = useCallback((kind: Kind, id: string) => setCur({ kind, id }), [])
  const close = useCallback(() => setCur(null), [])

  const value: EditorCtx = {
    open,
    createTask: p => { const t = newTask(p); add('tasks', t); open('task', t.id) },
    createNote: p => { const n = newNote(p); add('notes', n); open('note', n.id) },
    createProject: p => { const id = uid(); add('projects', { id, name: '', status: 'To Do', ...p }); open('project', id) },
    createGoal: p => { const id = uid(); add('goals', { id, title: '', done: false, why: '', ...p }); open('goal', id) },
    createBook: p => { const id = uid(); add('books', { id, title: '', author: '', rating: 0, status: 'Idee', notes: '', ...p }); open('book', id) },
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {cur && (
        <Modal onClose={close} wide={cur.kind === 'note' || cur.kind === 'project' || cur.kind === 'goal'}>
          {cur.kind === 'task' && <TaskEditor id={cur.id} close={close} />}
          {cur.kind === 'note' && <NoteEditor id={cur.id} close={close} />}
          {cur.kind === 'project' && <ProjectEditor id={cur.id} close={close} />}
          {cur.kind === 'goal' && <GoalEditor id={cur.id} close={close} />}
          {cur.kind === 'book' && <BookEditor id={cur.id} close={close} />}
          {cur.kind === 'area' && <AreaEditor id={cur.id} close={close} />}
          {cur.kind === 'resource' && <ResourceEditor id={cur.id} close={close} />}
          {cur.kind === 'habit' && <HabitEditor id={cur.id} close={close} />}
        </Modal>
      )}
    </Ctx.Provider>
  )
}

function TitleInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input autoFocus={!value} className="modal-title" value={value} placeholder={tr(placeholder)} onChange={e => onChange(e.target.value)} />
}

function Footer({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="modal-footer">
      <button className="btn danger ghost" onClick={() => { if (confirm(tr('Wirklich löschen?'))) onDelete() }}>{tr('Löschen')}</button>
    </div>
  )
}

function AreaSelect({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { db } = useStore()
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || undefined)}>
      <option value="">{tr('– keine Area –')}</option>
      {db.areas.filter(a => !a.archived || a.id === value).map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
    </select>
  )
}

function TaskEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const t = db.tasks.find(x => x.id === id)
  if (!t) return null
  const set = (p: Partial<typeof t>) => patch('tasks', id, p)
  return (
    <>
      <div className="modal-title-row">
        <Check checked={t.done} onChange={v => set({ done: v, doneAt: v ? new Date().toISOString() : undefined })} />
        <TitleInput value={t.title} onChange={title => set({ title })} placeholder="Neuer Task" />
      </div>
      <Prop label={tr('Fällig')}>
        <input type="date" value={t.due || ''} onChange={e => set({ due: e.target.value || undefined })} />
        <span className="quick-dates">
          <button className="chip" onClick={() => set({ due: today() })}>{tr('Heute')}</button>
          <button className="chip" onClick={() => set({ due: addDays(today(), 1) })}>{tr('Morgen')}</button>
          <button className="chip" onClick={() => set({ due: undefined })}>Inbox</button>
        </span>
      </Prop>
      <Prop label={tr('Priorität')}>
        <select value={t.priority} onChange={e => set({ priority: e.target.value as Priority })}>
          {PRIORITIES.map(p => <option key={p} value={p}>{p ? tr(p) : tr('Ohne Priority')}</option>)}
        </select>
      </Prop>
      <Prop label={tr('Projekt')}>
        <select value={t.projectId || ''} onChange={e => set({ projectId: e.target.value || undefined })}>
          <option value="">{tr('– kein Projekt –')}</option>
          {db.projects.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name || tr('Unbenannt')}</option>)}
        </select>
      </Prop>
      <Footer onDelete={() => { remove('tasks', id); close() }} />
    </>
  )
}

function NoteEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const n = db.notes.find(x => x.id === id)
  if (!n) return null
  const set = (p: Partial<typeof n>) => patch('notes', id, p)
  const resources = db.resources.filter(r => !n.areaId || r.areaId === n.areaId)
  return (
    <>
      <TitleInput value={n.title} onChange={title => set({ title })} placeholder="Neue Notiz" />
      <div className="props-grid">
        <Prop label={tr('Art')}>
          <select value={n.type} onChange={e => set({ type: e.target.value })}>
            {NOTE_TYPES.map(t => <option key={t} value={t}>{tr(t)}</option>)}
          </select>
        </Prop>
        <Prop label={tr('Favorit')}><Check checked={n.favorite} strike={false} onChange={favorite => set({ favorite })} label="⭐" /></Prop>
        <Prop label="Area"><AreaSelect value={n.areaId} onChange={areaId => set({ areaId })} /></Prop>
        <Prop label={tr('Resource / Fach')}>
          <select value={n.resourceId || ''} onChange={e => {
            const r = db.resources.find(x => x.id === e.target.value)
            set({ resourceId: e.target.value || undefined, areaId: r?.areaId ?? n.areaId })
          }}>
            <option value="">{tr('– keine –')}</option>
            {resources.map(r => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
          </select>
        </Prop>
        <Prop label="URL"><input value={n.url} placeholder="https://…" onChange={e => set({ url: e.target.value })} /></Prop>
        <Prop label={tr('Bewertung')}><Stars value={n.rating} onChange={rating => set({ rating })} /></Prop>
        <Prop label={tr('Nächstes Lernen')}>
          <input type="date" value={n.nextReview || ''} onChange={e => set({ nextReview: e.target.value || undefined })} />
        </Prop>
        <Prop label={tr('Wiederholt')}>
          <span className="muted">{n.reviewCount}×</span>
          <button className="chip" onClick={() => set({
            reviewCount: n.reviewCount + 1,
            nextReview: addDays(today(), REVIEW_STEPS[Math.min(n.reviewCount, REVIEW_STEPS.length - 1)]),
          })}>{tr('Heute wiederholt')}</button>
        </Prop>
        <Prop label={tr('Archiviert')}><Check checked={!!n.archived} strike={false} onChange={archived => set({ archived })} /></Prop>
      </div>
      <AutoText className="doc" minRows={10} value={n.content} placeholder={tr('Schreib los …')} onChange={content => set({ content })} />
      <Footer onDelete={() => { remove('notes', id); close() }} />
    </>
  )
}

function ProjectEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const ed = useEditor()
  const p = db.projects.find(x => x.id === id)
  if (!p) return null
  const set = (x: Partial<typeof p>) => patch('projects', id, x)
  const st = projectStats(db, id)
  return (
    <>
      <TitleInput value={p.name} onChange={name => set({ name })} placeholder="Neues Projekt" />
      <div className="props-grid">
        <Prop label="Status">
          <select value={p.status} onChange={e => set({ status: e.target.value as ProjectStatus })}>
            {STATUSES.map(s => <option key={s} value={s}>{tr(s)}</option>)}
          </select>
        </Prop>
        <Prop label={tr('Fortschritt')}><Progress value={st.progress} /></Prop>
        <Prop label="Area"><AreaSelect value={p.areaId} onChange={areaId => set({ areaId })} /></Prop>
        <Prop label={tr('Ziel')}>
          <select value={p.goalId || ''} onChange={e => set({ goalId: e.target.value || undefined })}>
            <option value="">{tr('– kein Ziel –')}</option>
            {db.goals.map(g => <option key={g.id} value={g.id}>{g.title || tr('Unbenannt')}</option>)}
          </select>
        </Prop>
        <Prop label="Meta"><span className="muted">{st.total} Tasks, {st.overdue} Overdue</span></Prop>
        <Prop label={tr('Archiviert')}><Check checked={!!p.archived} strike={false} onChange={archived => set({ archived })} /></Prop>
      </div>
      <h3 className="sub">Tasks</h3>
      <TaskList tasks={db.tasks.filter(t => t.projectId === id)} showProject={false} />
      <button className="add-row" onClick={() => ed.createTask({ projectId: id })}>+ {tr('Neuer Task')}</button>
      <Footer onDelete={() => { remove('projects', id); close() }} />
    </>
  )
}

function GoalEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const ed = useEditor()
  const g = db.goals.find(x => x.id === id)
  if (!g) return null
  const set = (x: Partial<typeof g>) => patch('goals', id, x)
  const projects = db.projects.filter(p => p.goalId === id)
  return (
    <>
      <div className="modal-title-row">
        <Check checked={g.done} onChange={done => set({ done })} />
        <TitleInput value={g.title} onChange={title => set({ title })} placeholder="Neues Ziel" />
      </div>
      <div className="props-grid">
        <Prop label="Area"><AreaSelect value={g.areaId} onChange={areaId => set({ areaId })} /></Prop>
        <Prop label="Deadline"><input type="date" value={g.deadline || ''} onChange={e => set({ deadline: e.target.value || undefined })} /></Prop>
      </div>
      <h3 className="sub">{tr('Warum ist mir dieses Ziel wichtig?')}</h3>
      <AutoText value={g.why} onChange={why => set({ why })} placeholder={tr('Mein Warum …')} />
      <h3 className="sub">{tr('Projekte')}</h3>
      <div className="list">
        {projects.map(p => (
          <button key={p.id} className="list-row" onClick={() => ed.open('project', p.id)}>
            <span>{p.name || tr('Unbenannt')}</span><Progress value={projectStats(db, p.id).progress} />
          </button>
        ))}
      </div>
      <button className="add-row" onClick={() => ed.createProject({ goalId: id, areaId: g.areaId })}>+ {tr('Neues Projekt')}</button>
      <Footer onDelete={() => { remove('goals', id); close() }} />
    </>
  )
}

function BookEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const b = db.books.find(x => x.id === id)
  if (!b) return null
  const set = (x: Partial<typeof b>) => patch('books', id, x)
  return (
    <>
      <TitleInput value={b.title} onChange={title => set({ title })} placeholder="Buchtitel" />
      <Prop label={tr('Autor')}><input value={b.author} onChange={e => set({ author: e.target.value })} /></Prop>
      <Prop label="Status">
        <select value={b.status} onChange={e => set({ status: e.target.value as BookStatus })}>
          {(['Idee', 'Am Lesen', 'Fertig'] as const).map(s => <option key={s} value={s}>{tr(s)}</option>)}
        </select>
      </Prop>
      <Prop label={tr('Bewertung')}><Stars value={b.rating} onChange={rating => set({ rating })} /></Prop>
      <h3 className="sub">{tr('Notizen & Learnings')}</h3>
      <AutoText minRows={6} value={b.notes} onChange={notes => set({ notes })} placeholder={tr('Was nehme ich mit?')} />
      <Footer onDelete={() => { remove('books', id); close() }} />
    </>
  )
}

function IconInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="icon-input" value={value} maxLength={4} onChange={e => onChange(e.target.value)} aria-label="Icon" />
}

function AreaEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const a = db.areas.find(x => x.id === id)
  if (!a) return null
  const set = (x: Partial<typeof a>) => patch('areas', id, x)
  return (
    <>
      <div className="modal-title-row"><IconInput value={a.icon} onChange={icon => set({ icon })} />
        <TitleInput value={a.name} onChange={name => set({ name })} placeholder="Neue Area" /></div>
      <Prop label={tr('Archiviert')}><Check checked={!!a.archived} strike={false} onChange={archived => set({ archived })} /></Prop>
      <Footer onDelete={() => { remove('areas', id); close() }} />
    </>
  )
}

function ResourceEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const r = db.resources.find(x => x.id === id)
  if (!r) return null
  const set = (x: Partial<typeof r>) => patch('resources', id, x)
  return (
    <>
      <div className="modal-title-row"><IconInput value={r.icon} onChange={icon => set({ icon })} />
        <TitleInput value={r.name} onChange={name => set({ name })} placeholder="Neue Resource" /></div>
      <Prop label="Root Area"><AreaSelect value={r.areaId} onChange={areaId => set({ areaId })} /></Prop>
      <Footer onDelete={() => { remove('resources', id); close() }} />
    </>
  )
}

function HabitEditor({ id, close }: { id: string; close: () => void }) {
  const { db, patch, remove } = useStore()
  const h = db.habits.find(x => x.id === id)
  if (!h) return null
  const set = (x: Partial<typeof h>) => patch('habits', id, x)
  return (
    <>
      <div className="modal-title-row"><IconInput value={h.icon} onChange={icon => set({ icon })} />
        <TitleInput value={h.name} onChange={name => set({ name })} placeholder="Neue Gewohnheit" /></div>
      <Prop label={tr('Art')}>
        <select value={h.kind} onChange={e => set({ kind: e.target.value as 'good' | 'bad' })}>
          <option value="good">{tr('Gute Gewohnheit (aufbauen)')}</option>
          <option value="bad">{tr('Schlechte Gewohnheit (loswerden)')}</option>
        </select>
      </Prop>
      {h.kind === 'good' && (
        <Prop label="Routine">
          <select value={habitRoutine(h)} onChange={e => set({ routine: e.target.value as Routine })}>
            <option value="morgen">☀️ {tr('Morgenroutine')}</option>
            <option value="abend">🌙 {tr('Abendroutine („Erledigt 2.0?“)')}</option>
          </select>
        </Prop>
      )}
      <Prop label={tr('Archiviert')}><Check checked={!!h.archived} strike={false} onChange={archived => set({ archived })} /></Prop>
      <Footer onDelete={() => { remove('habits', id); close() }} />
    </>
  )
}

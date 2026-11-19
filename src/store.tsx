import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { addDays, today, uid } from './utils'
import { t as tr } from './i18n'

export type Priority = 'Hoch' | 'Mittel' | 'Gering' | ''
export type ProjectStatus = 'To Do' | 'Doing' | 'Done' | 'On Hold'
export type BookStatus = 'Idee' | 'Am Lesen' | 'Fertig'

export type Routine = 'morgen' | 'abend'
export interface Habit { id: string; name: string; icon: string; kind: 'good' | 'bad'; routine?: Routine; archived?: boolean }
/** Wie im Template: Meditieren und Lesen gehören zur Abendroutine („Erledigt 2.0?“) */
const EVENING_HABITS = ['Meditieren', 'Lesen', 'Meditate', 'Read']
export const habitRoutine = (h: Habit): Routine => h.routine ?? (EVENING_HABITS.includes(h.name) ? 'abend' : 'morgen')
export interface Area { id: string; name: string; icon: string; archived?: boolean }
export interface Resource { id: string; name: string; icon: string; areaId?: string }
export interface Goal { id: string; title: string; areaId?: string; done: boolean; deadline?: string; why: string }
export interface Project { id: string; name: string; status: ProjectStatus; areaId?: string; goalId?: string; archived?: boolean }
export interface Task { id: string; title: string; done: boolean; due?: string; priority: Priority; projectId?: string; createdAt: string; doneAt?: string }
export interface Note {
  id: string; title: string; type: string; content: string; url: string
  areaId?: string; resourceId?: string; favorite: boolean; archived?: boolean
  createdAt: string; updatedAt: string
  nextReview?: string; reviewCount: number; rating: number
}
export interface Book { id: string; title: string; author: string; rating: number; status: BookStatus; notes: string }
export interface DayEntry { id: string; date: string; title: string; brainDump: string; gratitude: string[] }
export interface EveningEntry { id: string; date: string; title: string; brainDump: string; checks: Record<string, boolean> }
export interface WeekEntry {
  id: string; date: string; title: string; wentWell: string; burden: string; reflection: string
  checks: Record<string, boolean>
}
export interface FogPage { id: string; title: string; content: string; updatedAt: string }

export interface DB {
  name: string
  cycleStart: string
  antiVision: string
  visionBoard: string
  habits: Habit[]
  habitLog: Record<string, string[]>
  days: DayEntry[]
  evenings: EveningEntry[]
  weeks: WeekEntry[]
  areas: Area[]
  resources: Resource[]
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
  notes: Note[]
  books: Book[]
  fog: FogPage[]
  timetable: string[][]
}

export type CollectionKey = 'habits' | 'days' | 'evenings' | 'weeks' | 'areas' | 'resources' | 'goals' | 'projects' | 'tasks' | 'notes' | 'books' | 'fog'

export const EVENING_CHECKS = [
  'Helle Lichter ausmachen ab 22:00',
  'Eine Stunde vorm Schlafen das Handy in die Küche legen',
  'Zähne putzen, umziehen, Haus/Wohnung aufräumen',
]
export const WEEK_CHECKS = [
  'Termine und Gewohnheiten in den Kalender eingetragen?',
  'Projekte und Tasks der Woche eingetragen?',
  'Kurzen Moment für Dankbarkeit genommen?',
]
export const NOTE_TYPES = ['Notiz', 'Buch Notiz', 'Lernzettel/Mitschrift', 'Podcast', 'Zitat', 'Web-Artikel', 'Idee']
export const STATUSES: ProjectStatus[] = ['To Do', 'Doing', 'Done', 'On Hold']
export const PRIORITIES: Priority[] = ['Hoch', 'Mittel', 'Gering', '']

function seed(): DB {
  const now = new Date().toISOString()
  const t = today()
  const areas: Area[] = [
    { id: 'a-health', name: tr('Gesundheit'), icon: '🍏' },
    { id: 'a-school', name: tr('Schule/Studium'), icon: '🎓' },
    { id: 'a-edu', name: tr('Persönliche Bildung'), icon: '📚' },
    { id: 'a-life', name: tr('Glücklichkeit | Beziehungen | Leben'), icon: '❤️' },
    { id: 'a-wealth', name: tr('Wohlstand'), icon: '💰' },
    { id: 'a-travel', name: tr('Reisen'), icon: '✈️' },
  ]
  const habits: Habit[] = [
    ['Bewegung', '🏃'], ['Meditieren', '🧘'], ['Sonnenlicht', '☀️'], ['Bett machen', '🛏️'],
    ['Kalte Dusche', '🚿'], ['Wasser trinken', '💧'], ['Journal schreiben', '✍️'], ['Lesen', '📖'],
  ].map(([name, icon], i) => ({ id: 'h' + i, name: tr(name), icon, kind: 'good' as const, routine: (EVENING_HABITS.includes(name) ? 'abend' : 'morgen') as Routine }))
  habits.push({ id: 'hb0', name: tr('Social Media nach 21 Uhr'), icon: '📵', kind: 'bad' })

  // Beispielhafte Historie, damit der Graph nicht leer startet
  const habitLog: Record<string, string[]> = {}
  for (let i = 30; i >= 1; i--) {
    const d = addDays(t, -i)
    const level = 3 + ((i * 7) % 6) - (i > 20 ? 2 : 0)
    habitLog[d] = habits.filter((h, j) => h.kind === 'good' && (j * 5 + i * 3) % 9 < level).map(h => h.id)
  }

  return {
    name: '',
    cycleStart: addDays(t, -((new Date().getDay() + 6) % 7) - 14),
    antiVision: tr('Wie sieht mein Leben in 5 Jahren aus, wenn ich nichts ändere?') + '\n\n',
    visionBoard: tr('Wer will ich in 3 Jahren sein? Wie sieht ein perfekter Tag aus?') + '\n\n',
    habits,
    habitLog,
    days: [],
    evenings: [],
    weeks: [],
    areas,
    resources: [
      { id: 'r-hockey', name: tr('Hockeytraining'), icon: '🏑' },
      { id: 'r-food', name: tr('Ernährung'), icon: '🍏', areaId: 'a-health' },
      { id: 'r-prod', name: tr('Produktivität'), icon: '📈', areaId: 'a-edu' },
      { id: 'r-org', name: tr('Organisation'), icon: '📂', areaId: 'a-edu' },
      { id: 'r-bio', name: tr('Biochemie'), icon: '🧪', areaId: 'a-school' },
      { id: 'r-physio', name: tr('Physio'), icon: '🏷️', areaId: 'a-school' },
      { id: 'r-anat', name: tr('Anatomie'), icon: '🫁', areaId: 'a-school' },
    ],
    goals: [
      { id: 'g1', title: tr('3 Kilo Muskelmasse zunehmen'), areaId: 'a-health', done: false, deadline: addDays(t, 60), why: '' },
      { id: 'g2', title: tr('Anatomie Klausur bestehen'), areaId: 'a-school', done: false, deadline: addDays(t, 40), why: '' },
    ],
    projects: [
      { id: 'p1', name: tr('Ernährungspläne schreiben'), status: 'Doing', areaId: 'a-health', goalId: 'g1' },
      { id: 'p2', name: tr('Folien nachbereiten'), status: 'To Do', areaId: 'a-school', goalId: 'g2' },
      { id: 'p3', name: tr('Medizin TB6'), status: 'Done', areaId: 'a-school' },
    ],
    tasks: [
      { id: 't1', title: tr('Wochenplan Mahlzeiten erstellen'), done: true, priority: 'Mittel', projectId: 'p1', due: addDays(t, -2), createdAt: now, doneAt: now },
      { id: 't2', title: tr('Einkaufsliste schreiben'), done: false, priority: 'Gering', projectId: 'p1', due: t, createdAt: now },
      { id: 't3', title: tr('Folien Kapitel 1 nachbereiten'), done: false, priority: 'Hoch', projectId: 'p2', due: t, createdAt: now },
      { id: 't4', title: tr('Folien Kapitel 2 nachbereiten'), done: false, priority: 'Hoch', projectId: 'p2', due: addDays(t, 2), createdAt: now },
      { id: 't5', title: tr('Arzttermin vereinbaren'), done: false, priority: '', createdAt: now },
    ],
    notes: [
      { id: 'n1', title: 'The PARA Method', type: 'Web-Artikel', content: 'Projects, Areas, Resources, Archives.', url: 'https://fortelabs.com/blog/para/', resourceId: 'r-org', areaId: 'a-edu', favorite: true, createdAt: now, updatedAt: now, reviewCount: 0, rating: 0 },
      { id: 'n2', title: tr('Cooles Podcast Zitat'), type: 'Zitat', content: '', url: '', favorite: false, createdAt: now, updatedAt: now, reviewCount: 0, rating: 0 },
      { id: 'n3', title: tr('Knochen'), type: 'Lernzettel/Mitschrift', content: tr('Aufbau, Einteilung, Ossifikation …'), url: '', resourceId: 'r-anat', areaId: 'a-school', favorite: false, createdAt: now, updatedAt: now, nextReview: t, reviewCount: 1, rating: 3 },
      { id: 'n4', title: tr('Muskeln der oberen Extremität'), type: 'Lernzettel/Mitschrift', content: '', url: '', resourceId: 'r-anat', areaId: 'a-school', favorite: false, createdAt: now, updatedAt: now, nextReview: addDays(t, 3), reviewCount: 0, rating: 0 },
      { id: 'n5', title: tr('Citratzyklus'), type: 'Lernzettel/Mitschrift', content: '', url: '', resourceId: 'r-bio', areaId: 'a-school', favorite: false, createdAt: now, updatedAt: now, nextReview: addDays(t, 1), reviewCount: 2, rating: 4 },
    ],
    books: [
      { id: 'b1', title: tr('Der Weg der Könige'), author: 'Brandon Sanderson', rating: 0, status: 'Am Lesen', notes: '' },
      { id: 'b2', title: 'Oversubscribed', author: 'Daniel Priestley', rating: 5, status: 'Idee', notes: '' },
      { id: 'b3', title: '$100M Offers', author: 'Alex Hormozi', rating: 5, status: 'Idee', notes: '' },
      { id: 'b4', title: 'Atomic Habits', author: 'James Clear', rating: 5, status: 'Fertig', notes: '' },
      { id: 'b5', title: 'Key Person of Influence', author: 'Daniel Priestley', rating: 5, status: 'Idee', notes: '' },
    ],
    fog: [{ id: 'f1', title: tr('Was geht mir gerade durch den Kopf?'), content: '', updatedAt: now }],
    timetable: Array.from({ length: 10 }, () => ['', '', '', '', '']),
  }
}

const KEY = '12wm-db-v1'

export function emptyDB(): DB {
  return {
    ...seed(), habitLog: {}, days: [], evenings: [], weeks: [], goals: [], projects: [], tasks: [], notes: [], books: [],
    fog: [{ id: uid(), title: tr('Seite {n}', { n: 1 }), content: '', updatedAt: new Date().toISOString() }],
    antiVision: '', visionBoard: '',
  }
}

/**
 * Bringt beliebige (z. B. alte, importierte oder beschädigte) Daten in eine gültige Form:
 * fehlende Felder kommen aus den Standardwerten, falsche Typen werden durch leere Werte ersetzt.
 */
export function normalize(input: unknown): DB {
  const base = seed()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base
  const d = input as Record<string, unknown>
  const out = { ...base } as Record<string, unknown>
  for (const key of Object.keys(base) as (keyof DB)[]) {
    if (!(key in d)) continue
    const def = base[key], val = d[key]
    if (Array.isArray(def)) out[key] = Array.isArray(val) ? val.filter(x => x !== null && typeof x === 'object' || key === 'timetable') : []
    else if (typeof def === 'object') out[key] = val && typeof val === 'object' && !Array.isArray(val) ? val : {}
    else if (typeof def === 'string') out[key] = typeof val === 'string' ? val : def
  }
  return out as unknown as DB
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return normalize(JSON.parse(raw))
  } catch { /* ignore */ }
  return seed()
}

type Ctx = {
  db: DB
  update: (fn: (d: DB) => void) => void
  add: <K extends CollectionKey>(k: K, item: DB[K][number]) => void
  patch: <K extends CollectionKey>(k: K, id: string, p: Partial<DB[K][number]>) => void
  remove: (k: CollectionKey, id: string) => void
  reset: () => void
  /** Ersetzt den kompletten Zustand (Import, Server-Stand) */
  replace: (d: Partial<DB>) => void
}

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* ignore */ }
  }, [db])

  const update = (fn: (d: DB) => void) =>
    setDb(prev => { const d = structuredClone(prev); fn(d); return d })

  const value: Ctx = {
    db,
    update,
    add: (k, item) => update(d => { (d[k] as unknown[]).unshift(item) }),
    patch: (k, id, p) => update(d => {
      const arr = d[k] as { id: string }[]
      const i = arr.findIndex(x => x.id === id)
      if (i >= 0) {
        arr[i] = { ...arr[i], ...p }
        if (k === 'notes' || k === 'fog') (arr[i] as Note).updatedAt = new Date().toISOString()
      }
    }),
    remove: (k, id) => update(d => {
      ;(d[k] as { id: string }[]) = (d[k] as { id: string }[]).filter(x => x.id !== id)
    }),
    reset: () => setDb(seed()),
    replace: d => setDb(normalize(d)),
  }
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const c = useContext(StoreCtx)
  if (!c) throw new Error('StoreProvider fehlt')
  return c
}

// ---------- Ableitungen ----------
export function projectStats(db: DB, projectId: string) {
  const p = db.projects.find(x => x.id === projectId)
  const tasks = db.tasks.filter(t => t.projectId === projectId)
  const done = tasks.filter(t => t.done).length
  const overdue = tasks.filter(t => !t.done && t.due && t.due < today()).length
  const progress = p?.status === 'Done' ? 100 : tasks.length ? Math.round((done / tasks.length) * 100) : 0
  return { total: tasks.length, done, overdue, progress }
}

export function goalProgress(db: DB, goalId: string) {
  const ps = db.projects.filter(p => p.goalId === goalId)
  if (!ps.length) return 0
  return Math.round(ps.reduce((s, p) => s + projectStats(db, p.id).progress, 0) / ps.length)
}

export function habitRate(db: DB, date: string) {
  const good = db.habits.filter(h => h.kind === 'good' && !h.archived)
  if (!good.length) return 0
  const done = (db.habitLog[date] || []).filter(id => good.some(h => h.id === id)).length
  return Math.round((done / good.length) * 100)
}

export function newTask(p: Partial<Task> = {}): Task {
  return { id: uid(), title: '', done: false, priority: '', createdAt: new Date().toISOString(), ...p }
}
export function newNote(p: Partial<Note> = {}): Note {
  const now = new Date().toISOString()
  return { id: uid(), title: '', type: 'Notiz', content: '', url: '', favorite: false, createdAt: now, updatedAt: now, reviewCount: 0, rating: 0, ...p }
}

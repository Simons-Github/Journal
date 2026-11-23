import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { prisma } from '../db.js'

/**
 * Werkzeuge des Assistenten. Sie lesen den zuletzt synchronisierten Workspace aus der Datenbank
 * und ändern nichts. Journal-Einträge (Morgen, Abend, Woche) und Habits bekommt die KI bewusst nicht.
 */

// ---------- Ausschnitt des Workspace-Formats (vollständig in src/store.tsx) ----------
interface Named { id: string; name?: string; title?: string }
interface Task { id: string; title: string; done: boolean; due?: string; priority: string; projectId?: string; doneAt?: string }
interface Project { id: string; name: string; status: string; areaId?: string; goalId?: string; archived?: boolean }
interface Goal { id: string; title: string; done: boolean; deadline?: string; areaId?: string }
interface Note {
  id: string; title: string; type: string; content: string; url: string
  areaId?: string; resourceId?: string; archived?: boolean; updatedAt: string; nextReview?: string
}
interface Book { id: string; title: string; author: string; status: string; notes: string }
interface FogPage { id: string; title: string; content: string; updatedAt: string }
export interface Workspace {
  tasks: Task[]; projects: Project[]; goals: Goal[]; notes: Note[]; books: Book[]; fog: FogPage[]
  areas: Named[]; resources: Named[]
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as T[] : [])

export async function loadWorkspace(userId: string): Promise<Workspace> {
  const w = await prisma.workspace.findUnique({ where: { userId }, select: { data: true } })
  const d = (w?.data && typeof w.data === 'object' && !Array.isArray(w.data) ? w.data : {}) as Record<string, unknown>
  return {
    tasks: list(d.tasks), projects: list(d.projects), goals: list(d.goals), notes: list(d.notes),
    books: list(d.books), fog: list(d.fog), areas: list(d.areas), resources: list(d.resources),
  }
}

// ---------- Suche ----------
/** Kleinschreibung ohne Akzente, damit „Übung“ auch „ubung“ findet */
const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss')
const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'zu', 'in', 'im', 'mit', 'von', 'the', 'and', 'or', 'a', 'an', 'of', 'to', 'for', 'about', 'meine', 'mein', 'my'])
const terms = (q: string) => [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w)))]

/** Treffer-Kontext: ein Ausschnitt rund um das erste gefundene Wort */
function snippet(text: string, ts: string[], size = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const f = fold(flat)
  const pos = Math.min(...ts.map(t => f.indexOf(t)).filter(i => i >= 0), Infinity)
  const start = Number.isFinite(pos) ? Math.max(0, pos - size / 3) : 0
  const out = flat.slice(start, start + size)
  return (start > 0 ? '…' : '') + out + (start + size < flat.length ? '…' : '')
}

export type SourceKind = 'note' | 'book' | 'fog' | 'task' | 'project'
export interface Source { kind: SourceKind; id: string; title: string }

interface Doc { kind: SourceKind; id: string; title: string; body: string; meta: Record<string, string | undefined> }

function documents(ws: Workspace, kinds: string[]): Doc[] {
  const nameOf = (arr: Named[], id?: string) => (id ? arr.find(x => x.id === id)?.name : undefined)
  const docs: Doc[] = []
  if (kinds.includes('notes')) for (const n of ws.notes) {
    if (n.archived) continue
    docs.push({
      kind: 'note', id: n.id, title: n.title || '(ohne Titel)', body: `${n.content ?? ''} ${n.url ?? ''}`,
      meta: { type: n.type, area: nameOf(ws.areas, n.areaId), resource: nameOf(ws.resources, n.resourceId), updated: n.updatedAt?.slice(0, 10), url: n.url || undefined },
    })
  }
  if (kinds.includes('books')) for (const b of ws.books) {
    docs.push({ kind: 'book', id: b.id, title: b.title, body: `${b.author ?? ''} ${b.notes ?? ''}`, meta: { author: b.author, status: b.status } })
  }
  if (kinds.includes('brain_dump')) for (const p of ws.fog) {
    docs.push({ kind: 'fog', id: p.id, title: p.title || 'Brain Dump', body: p.content ?? '', meta: { updated: p.updatedAt?.slice(0, 10) } })
  }
  return docs
}

export function searchDocs(ws: Workspace, query: string, kinds: string[], limit: number) {
  const ts = terms(query)
  if (!ts.length) return []
  return documents(ws, kinds)
    .map(d => {
      const title = fold(d.title), body = fold(`${d.body} ${Object.values(d.meta).join(' ')}`)
      let score = 0, hits = 0
      for (const t of ts) {
        const inTitle = title.includes(t), inBody = body.includes(t)
        if (inTitle || inBody) hits++
        if (inTitle) score += 3
        if (inBody) score += 1 + Math.min(3, body.split(t).length - 2) * 0.25
      }
      // Treffer mit mehr verschiedenen Suchwörtern zuerst
      return { d, score: score + hits * 2, hits }
    })
    .filter(r => r.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ kind: d.kind, id: d.id, title: d.title, ...Object.fromEntries(Object.entries(d.meta).filter(([, v]) => v)), snippet: snippet(`${d.body}`, ts) }))
}

// ---------- Werkzeug-Definitionen ----------
const searchInput = z.object({
  query: z.string().min(1).max(200),
  in: z.array(z.enum(['notes', 'books', 'brain_dump'])).optional(),
  limit: z.number().int().min(1).max(20).optional(),
})
const getInput = z.object({ kind: z.enum(['note', 'book', 'brain_dump']), id: z.string().min(1).max(64) })
const tasksInput = z.object({
  status: z.enum(['open', 'done', 'all']).optional(),
  due_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  project_id: z.string().max(64).optional(),
  text: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})
const projectsInput = z.object({ include_done: z.boolean().optional() })
const PRIORITIES = ['Hoch', 'Mittel', 'Gering'] as const
const proposeInput = z.object({
  project: z.object({
    existing_id: z.string().max(64).optional(),
    new_name: z.string().trim().min(1).max(120).optional(),
  }).optional(),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_in_days: z.number().int().min(0).max(730).optional(),
    priority: z.enum(PRIORITIES).optional(),
  })).min(1).max(30),
})

// ---------- Datum (reine Kalenderdaten, unabhängig von der Zeitzone des Servers) ----------
const toDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const fromDate = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fromDate(d) }
/** Gibt es das Datum wirklich (kein 30. Februar)? */
const isRealDate = (s: string) => fromDate(toDate(s)) === s
export const weekdayName = (s: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][toDate(s).getUTCDay()]

/** Vorschlag für neue Tasks: wird im Chat als Karte gezeigt, der Nutzer übernimmt ihn selbst */
export interface Proposal {
  project: { id: string; name: string } | { newName: string } | null
  tasks: { title: string; due?: string; priority: '' | (typeof PRIORITIES)[number] }[]
}
export interface ToolContext { today: string }

const DATE = { type: 'string', description: 'Datum im Format YYYY-MM-DD' } as const

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_notes',
    description: 'Durchsucht die Notizen, Lernzettel, Bücher und Brain-Dump-Seiten des Nutzers nach Stichwörtern (keine semantische Suche). ' +
      'Liefert Titel, Metadaten und einen kurzen Ausschnitt. Bei wenigen Treffern mit Synonymen oder der anderen Sprache (Deutsch/Englisch) erneut suchen. ' +
      'Für den vollständigen Text danach get_note verwenden.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchwörter, z. B. „Citratzyklus Enzyme“' },
        in: { type: 'array', items: { type: 'string', enum: ['notes', 'books', 'brain_dump'] }, description: 'Wo gesucht wird; Standard: überall' },
        limit: { type: 'integer', description: 'Max. Anzahl Treffer (1–20), Standard 8' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_note',
    description: 'Liest den vollständigen Inhalt einer Notiz, eines Buchs oder einer Brain-Dump-Seite anhand der ID aus search_notes.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['note', 'book', 'brain_dump'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'Listet Tasks des Nutzers mit Fälligkeit, Priorität und Projekt. Ohne Filter: offene Tasks, nach Fälligkeit sortiert.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Standard: open' },
        due_from: { ...DATE, description: 'Nur Tasks, die an oder nach diesem Datum fällig sind (YYYY-MM-DD)' },
        due_to: { ...DATE, description: 'Nur Tasks, die an oder vor diesem Datum fällig sind (YYYY-MM-DD)' },
        project_id: { type: 'string', description: 'Nur Tasks dieses Projekts (ID aus list_projects)' },
        text: { type: 'string', description: 'Nur Tasks, deren Titel diese Wörter enthält' },
        limit: { type: 'integer', description: 'Max. Anzahl (1–100), Standard 40' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: 'Listet Projekte mit Status, Ziel, Bereich und Task-Fortschritt sowie die Ziele des 12-Wochen-Jahres.',
    input_schema: {
      type: 'object',
      properties: { include_done: { type: 'boolean', description: 'Auch erledigte und archivierte Projekte; Standard false' } },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_tasks',
    description: 'Schlägt dem Nutzer neue Tasks vor. Sie werden NICHT gespeichert, sondern als Karte im Chat gezeigt; ' +
      'der Nutzer prüft, bearbeitet und übernimmt sie selbst. Pro Antwort höchstens einmal aufrufen und die Tasks danach nicht noch einmal als Text auflisten. ' +
      'Tasks konkret und abhakbar formulieren (Verb am Anfang, z. B. „Kapitel 3 lesen“), nicht zu viele (meist 3–10).',
    input_schema: {
      type: 'object',
      properties: {
        project: {
          type: 'object',
          description: 'Optional: bestehendes Projekt (ID aus list_projects) ODER Name für ein neues Projekt, wenn die Tasks zusammengehören und kein passendes existiert.',
          properties: {
            existing_id: { type: 'string' },
            new_name: { type: 'string' },
          },
          additionalProperties: false,
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              due_in_days: { type: 'integer', description: 'Fällig in so vielen Tagen ab heute (0 = heute). Bevorzugen für relative Angaben wie „morgen“ oder „in einer Woche“.' },
              due: { ...DATE, description: 'Fälligkeitsdatum YYYY-MM-DD, wenn der Nutzer ein festes Datum oder einen Wochentag nennt (Kalender im System-Prompt verwenden).' },
              priority: { type: 'string', enum: [...PRIORITIES] },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
]

const MAX_NOTE_CHARS = 12_000

/**
 * Führt ein Werkzeug aus. Gibt das Ergebnis als Text für das Modell zurück, dazu die gefundenen
 * Quellen (für Links im Chat) und bei propose_tasks den Vorschlag für die Karte.
 */
export function runTool(ws: Workspace, name: string, raw: unknown, ctx: ToolContext): { result: string; sources: Source[]; proposal?: Proposal } {
  const json = (v: unknown) => JSON.stringify(v)
  const nameOf = (arr: Named[], id?: string) => (id ? arr.find(x => x.id === id)?.name ?? arr.find(x => x.id === id)?.title : undefined)

  switch (name) {
    case 'search_notes': {
      const i = searchInput.parse(raw)
      const hits = searchDocs(ws, i.query, i.in?.length ? i.in : ['notes', 'books', 'brain_dump'], i.limit ?? 8)
      return {
        result: json(hits.length ? hits : { hits: 0, hint: 'Keine Treffer. Andere Stichwörter, Synonyme oder die andere Sprache probieren.' }),
        sources: hits.map(h => ({ kind: h.kind, id: h.id, title: h.title })),
      }
    }
    case 'get_note': {
      const i = getInput.parse(raw)
      const clip = (s: string) => (s.length > MAX_NOTE_CHARS ? s.slice(0, MAX_NOTE_CHARS) + '\n[… gekürzt]' : s)
      if (i.kind === 'note') {
        const n = ws.notes.find(x => x.id === i.id)
        if (!n) return { result: json({ error: 'Notiz nicht gefunden' }), sources: [] }
        return {
          result: json({ id: n.id, title: n.title, type: n.type, url: n.url || undefined, area: nameOf(ws.areas, n.areaId), resource: nameOf(ws.resources, n.resourceId), updated: n.updatedAt?.slice(0, 10), next_review: n.nextReview, content: clip(n.content ?? '') }),
          sources: [{ kind: 'note', id: n.id, title: n.title }],
        }
      }
      if (i.kind === 'book') {
        const b = ws.books.find(x => x.id === i.id)
        if (!b) return { result: json({ error: 'Buch nicht gefunden' }), sources: [] }
        return { result: json({ ...b, notes: clip(b.notes ?? '') }), sources: [{ kind: 'book', id: b.id, title: b.title }] }
      }
      const p = ws.fog.find(x => x.id === i.id)
      if (!p) return { result: json({ error: 'Seite nicht gefunden' }), sources: [] }
      return { result: json({ id: p.id, title: p.title, updated: p.updatedAt?.slice(0, 10), content: clip(p.content ?? '') }), sources: [{ kind: 'fog', id: p.id, title: p.title }] }
    }
    case 'list_tasks': {
      const i = tasksInput.parse(raw)
      const status = i.status ?? 'open'
      const words = i.text ? terms(i.text) : []
      const tasks = ws.tasks
        .filter(t => (status === 'all' ? true : status === 'done' ? t.done : !t.done))
        .filter(t => !i.due_from || (t.due && t.due >= i.due_from))
        .filter(t => !i.due_to || (t.due && t.due <= i.due_to))
        .filter(t => !i.project_id || t.projectId === i.project_id)
        .filter(t => words.every(w => fold(t.title).includes(w)))
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
      const shown = tasks.slice(0, i.limit ?? 40)
      return {
        result: json({
          total: tasks.length,
          tasks: shown.map(t => ({ id: t.id, title: t.title, done: t.done, due: t.due, priority: t.priority || undefined, project: nameOf(ws.projects, t.projectId), done_at: t.doneAt?.slice(0, 10) })),
        }),
        sources: [],
      }
    }
    case 'list_projects': {
      const i = projectsInput.parse(raw)
      const projects = ws.projects
        .filter(p => i.include_done || (!p.archived && p.status !== 'Done'))
        .map(p => {
          const ts = ws.tasks.filter(t => t.projectId === p.id)
          return {
            id: p.id, name: p.name, status: p.status, archived: p.archived || undefined,
            goal: nameOf(ws.goals as Named[], p.goalId), area: nameOf(ws.areas, p.areaId),
            tasks_open: ts.filter(t => !t.done).length, tasks_done: ts.filter(t => t.done).length,
          }
        })
      const goals = ws.goals.filter(g => i.include_done || !g.done)
        .map(g => ({ id: g.id, title: g.title, done: g.done, deadline: g.deadline, area: nameOf(ws.areas, g.areaId) }))
      return { result: json({ projects, goals }), sources: [] }
    }
    case 'propose_tasks': {
      const i = proposeInput.parse(raw)
      const notes: string[] = []

      let project: Proposal['project'] = null
      if (i.project?.existing_id) {
        const p = ws.projects.find(x => x.id === i.project!.existing_id)
        if (p) project = { id: p.id, name: p.name }
        else notes.push(`Projekt-ID ${i.project.existing_id} gibt es nicht; die Tasks sind ohne Projekt vorgeschlagen.`)
      } else if (i.project?.new_name) {
        const same = ws.projects.find(x => !x.archived && fold(x.name) === fold(i.project!.new_name!))
        project = same ? { id: same.id, name: same.name } : { newName: i.project.new_name }
      }

      // Datum im Code berechnen statt dem Modell zu glauben; unmögliche Daten fallen weg
      const tasks = i.tasks.map(t => {
        let due = t.due_in_days !== undefined ? addDays(ctx.today, t.due_in_days) : t.due
        if (due && !isRealDate(due)) { notes.push(`„${t.title}“: ${due} ist kein gültiges Datum, Fälligkeit entfernt.`); due = undefined }
        else if (due && due < ctx.today) notes.push(`„${t.title}“: ${due} liegt in der Vergangenheit.`)
        return { title: t.title, due, priority: t.priority ?? '' as const }
      })

      const dupes = tasks.filter(t => ws.tasks.some(x => !x.done && fold(x.title) === fold(t.title)))
      if (dupes.length) notes.push(`Schon als offene Tasks vorhanden: ${dupes.map(d => `„${d.title}“`).join(', ')}.`)

      return {
        result: json({
          shown_to_user: true,
          saved: false,
          tasks: tasks.map(t => ({ title: t.title, due: t.due && `${t.due} (${weekdayName(t.due)})`, priority: t.priority || undefined })),
          project: project && ('newName' in project ? `neues Projekt „${project.newName}“` : project.name),
          notes: notes.length ? notes : undefined,
          next: 'Der Nutzer sieht die Tasks als Karte und übernimmt sie selbst. Schreibe höchstens 1–2 kurze Sätze (z. B. zur Reihenfolge oder zu den Hinweisen) und liste die Tasks nicht noch einmal auf.',
        }),
        sources: [],
        proposal: { project, tasks },
      }
    }
    default:
      return { result: json({ error: `Unbekanntes Werkzeug: ${name}` }), sources: [] }
  }
}

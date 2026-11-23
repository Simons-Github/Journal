import type { Priority } from './store'
import { addDays } from './utils'

/**
 * Kurs-Import im Browser: Die KI liefert nur die Kursstruktur (Wochen, Einheiten, Aufwand, Zitat).
 * Wann was fällig ist, rechnet dieser Code aus – nachvollziehbar und ohne erneuten KI-Aufruf,
 * wenn du Startdatum oder Tempo änderst.
 */

export type Kind = 'lecture' | 'reading' | 'assignment' | 'exam' | 'project' | 'review' | 'other'
export interface CourseItem { kind: Kind; title: string; hours: number; quote: string; verified: boolean }
export interface CourseUnit { week: number; title: string; items: CourseItem[] }
export interface Course {
  title: string; provider: string; summary: string; weeks_inferred: boolean; warnings: string[]; units: CourseUnit[]
}

export const KIND_LABEL: Record<Kind, string> = {
  lecture: 'Vorlesung', reading: 'Lektüre', assignment: 'Aufgabe', exam: 'Prüfung', project: 'Projekt', review: 'Übung', other: 'Sonstiges',
}
export const ALL_KINDS = Object.keys(KIND_LABEL) as Kind[]

export type Pace = { mode: 'course' } | { mode: 'hours'; hoursPerWeek: number }

export interface PlannedTask {
  /** Stabiler Schlüssel: Einheit und Position im Kurs */
  key: string
  unitWeek: number
  /** Kalenderwoche im Plan, ab 0 */
  planWeek: number
  title: string
  due: string
  priority: Priority
  kind: Kind
  hours: number
  quote: string
  verified: boolean
}

/** Tag innerhalb der Woche (0 = Starttag): erst Stoff, dann Übung, Abgaben und Prüfungen zum Wochenende hin */
const DAY: Record<Kind, number> = { lecture: 0, reading: 1, other: 2, review: 3, assignment: 4, project: 4, exam: 4 }
const PRIORITY: Record<Kind, Priority> = { exam: 'Hoch', assignment: 'Mittel', project: 'Mittel', lecture: '', reading: '', review: '', other: '' }

export function plan(course: Course, start: string, pace: Pace, kinds: Set<Kind>): PlannedTask[] {
  const items = course.units.flatMap(u => u.items.map((it, i) => ({ u, it, key: `${u.week}-${i}` }))).filter(x => kinds.has(x.it.kind))
  const firstWeek = Math.min(...course.units.map(u => u.week), Infinity)
  const out: PlannedTask[] = []

  if (pace.mode === 'course') {
    // Kurswoche n → Planwoche n − erste Woche; Tag nach Art, mehrere gleiche (z. B. zwei Vorlesungen) im Abstand von zwei Tagen
    const seen = new Map<string, number>()
    for (const { u, it, key } of items) {
      const planWeek = Math.max(0, u.week - (Number.isFinite(firstWeek) ? firstWeek : 1))
      const slot = `${u.week}-${it.kind}`
      const rank = seen.get(slot) ?? 0
      seen.set(slot, rank + 1)
      out.push(task(key, u, it, planWeek, addDays(start, planWeek * 7 + Math.min(6, DAY[it.kind] + rank * 2))))
    }
    return out
  }

  // Nach Stunden: der Reihe nach in Wochen packen; Fälligkeit dort, wo der Aufwand in der Woche erledigt ist
  const cap = Math.max(1, pace.hoursPerWeek)
  let week = 0, used = 0
  for (const { u, it, key } of items) {
    const h = Math.max(0.25, it.hours)
    if (used > 0 && used + h > cap) { week++; used = 0 }
    used += h
    // Größere Brocken als eine Woche belegen weitere Wochen
    const extra = Math.floor((used - 0.001) / cap)
    const dayInWeek = Math.min(6, Math.round(((used - extra * cap) / cap) * 6))
    out.push(task(key, u, it, week + extra, addDays(start, (week + extra) * 7 + dayInWeek)))
    if (extra > 0) { week += extra; used -= extra * cap }
  }
  return out
}

function task(key: string, u: CourseUnit, it: CourseItem, planWeek: number, due: string): PlannedTask {
  return { key, unitWeek: u.week, planWeek, title: it.title, due, priority: PRIORITY[it.kind], kind: it.kind, hours: it.hours, quote: it.quote, verified: it.verified }
}

export const totalHours = (tasks: { hours: number }[]) => Math.round(tasks.reduce((s, t) => s + t.hours, 0) * 10) / 10

/** Text einer Übersichtsnotiz zum Kurs (Zusammenfassung und Wochenplan) */
export function overviewNote(course: Course, tasks: PlannedTask[], fmt: (d: string) => string, label: (k: Kind) => string, weekLabel: (n: number) => string): string {
  const lines = [course.summary, '']
  if (course.provider) lines.push(course.provider, '')
  const byUnit = new Map<number, PlannedTask[]>()
  for (const t of tasks) byUnit.set(t.unitWeek, [...(byUnit.get(t.unitWeek) ?? []), t])
  for (const u of course.units) {
    const ts = byUnit.get(u.week)
    if (!ts?.length) continue
    lines.push(`${weekLabel(u.week)}${u.title ? ` – ${u.title}` : ''}`)
    for (const t of ts) lines.push(`- ${t.title} (${label(t.kind)}, ${fmt(t.due)})`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

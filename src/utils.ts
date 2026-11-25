import { locale, t as tr } from './i18n'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const today = () => isoDate(new Date())
export const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d) }
export const diffDays = (a: string, b: string) => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000)

export const fmtDate = (s?: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  s ? parseDate(s).toLocaleDateString(locale(), opts) : ''
export const fmtShort = (s?: string) => fmtDate(s, { day: '2-digit', month: '2-digit' })
export const weekday = (s: string) => fmtDate(s, { weekday: 'long' })

/** Montag der Woche */
export const startOfWeek = (s: string) => { const d = parseDate(s); const wd = (d.getDay() + 6) % 7; return addDays(s, -wd) }

export function dueLabel(due?: string) {
  if (!due) return ''
  const t = today()
  const n = diffDays(due, t)
  if (n === 0) return tr('Heute')
  if (n === 1) return tr('Morgen')
  if (n === -1) return tr('Gestern')
  if (n < 0) return tr('{n} Tage überfällig', { n: -n })
  if (n < 7) return weekday(due)
  return fmtDate(due, { day: 'numeric', month: 'short' })
}

/** Wiederholungsintervalle (Spaced Repetition) in Tagen */
export const REVIEW_STEPS = [1, 3, 7, 14, 30, 60]

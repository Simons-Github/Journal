import {
  BookOpen, Brain, CalendarRange, FolderKanban, GraduationCap, House, Layers, ListChecks,
  NotebookPen, Repeat, Sunrise, Sunset, Target, type LucideIcon,
} from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; description: string }
export interface NavGroup { title: string; items: NavItem[] }

export const HOME: NavItem = { to: '/', label: 'Today', icon: House, description: 'Dein Tag auf einen Blick' }

export const NAV: NavGroup[] = [
  { title: 'Reflect', items: [
    { to: '/morgen', label: 'Morning', icon: Sunrise, description: 'Mit Absicht in den Tag starten' },
    { to: '/abend', label: 'Evening', icon: Sunset, description: 'Den Tag abschließen und loslassen' },
    { to: '/woche', label: 'Weekly Review', icon: CalendarRange, description: 'Was lief gut, was belastet, was kommt' },
    { to: '/brain-fog', label: 'Brain Dump', icon: Brain, description: 'Ungefiltert aufschreiben, was dich beschäftigt' },
  ] },
  { title: 'Plan', items: [
    { to: '/ziele', label: 'Goals', icon: Target, description: 'Dein 12-Wochen-Jahr, Vision und Ziele' },
    { to: '/projekte', label: 'Projects', icon: FolderKanban, description: 'Was dich deinen Zielen näher bringt' },
    { to: '/areas', label: 'Areas', icon: Layers, description: 'Bereiche, die du dauerhaft pflegst, und dein Wissen dazu' },
  ] },
  { title: 'Do', items: [
    { to: '/todo', label: 'Tasks', icon: ListChecks, description: 'Was heute, morgen und diese Woche ansteht' },
    { to: '/habits', label: 'Habits', icon: Repeat, description: 'Gute aufbauen, schlechte loswerden' },
    { to: '/notizen', label: 'Notes', icon: NotebookPen, description: 'Sammeln, sortieren, wiederfinden' },
    { to: '/studium', label: 'Study', icon: GraduationCap, description: 'Fächer, Lernzettel und Stundenplan' },
    { to: '/buecher', label: 'Books', icon: BookOpen, description: 'Was du liest und gelesen hast' },
  ] },
]

export const ALL_NAV: NavItem[] = [HOME, ...NAV.flatMap(g => g.items)]

/** Navigationseintrag zu einem Pfad (für Seitentitel und Beschreibung) */
export function navFor(pathname: string): NavItem | undefined {
  if (pathname === '/') return HOME
  return ALL_NAV.find(i => i.to !== '/' && pathname.startsWith(i.to))
}

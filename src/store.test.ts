import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDB, goalProgress, habitRate, newTask, normalize, projectStats, type DB, type Project } from './store'

const project = (id: string, p: Partial<Project> = {}): Project => ({ id, name: id, status: 'Doing', ...p })

function db(p: Partial<DB>): DB {
  return { ...emptyDB(), habits: [], ...p }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0))
})
afterEach(() => { vi.useRealTimers() })

describe('projectStats', () => {
  it('derives progress and overdue tasks from the project tasks', () => {
    const d = db({
      projects: [project('p1')],
      tasks: [
        newTask({ projectId: 'p1', done: true }),
        newTask({ projectId: 'p1', done: true }),
        newTask({ projectId: 'p1', due: '2026-06-09' }), // overdue
        newTask({ projectId: 'p1', due: '2026-06-10' }), // due today, not overdue
        newTask({ projectId: 'p1', due: '2026-06-01', done: true }), // done, so not overdue
        newTask({ projectId: 'other', done: true }),
      ],
    })
    expect(projectStats(d, 'p1')).toEqual({ total: 5, done: 3, overdue: 1, progress: 60 })
  })

  it('is 0 % without tasks and 100 % once the project is done', () => {
    const d = db({ projects: [project('empty'), project('finished', { status: 'Done' })], tasks: [newTask({ projectId: 'finished' })] })
    expect(projectStats(d, 'empty').progress).toBe(0)
    expect(projectStats(d, 'finished').progress).toBe(100)
  })
})

describe('goalProgress', () => {
  it('averages the progress of the projects linked to a goal', () => {
    const d = db({
      projects: [project('a', { goalId: 'g' }), project('b', { goalId: 'g', status: 'Done' }), project('c', { goalId: 'other', status: 'Done' })],
      tasks: [newTask({ projectId: 'a', done: true }), newTask({ projectId: 'a' }), newTask({ projectId: 'a' })],
    })
    // a: 1 of 3 = 33 %, b: done = 100 % → 67 %
    expect(goalProgress(d, 'g')).toBe(67)
  })

  it('is 0 without linked projects', () => {
    expect(goalProgress(db({}), 'g')).toBe(0)
  })
})

describe('habitRate', () => {
  const habits: DB['habits'] = [
    { id: 'h1', name: 'Sport', icon: '', kind: 'good' },
    { id: 'h2', name: 'Lesen', icon: '', kind: 'good' },
    { id: 'h3', name: 'Alt', icon: '', kind: 'good', archived: true },
    { id: 'h4', name: 'Doomscrolling', icon: '', kind: 'bad' },
  ]

  it('counts only active good habits', () => {
    const d = db({ habits, habitLog: { '2026-06-10': ['h1', 'h3', 'h4', 'deleted'] } })
    expect(habitRate(d, '2026-06-10')).toBe(50)
    expect(habitRate(d, '2026-06-09')).toBe(0)
  })

  it('is 0 when there are no good habits', () => {
    expect(habitRate(db({ habitLog: { '2026-06-10': ['x'] } }), '2026-06-10')).toBe(0)
  })
})

describe('normalize', () => {
  it('falls back to defaults for anything that is not an object', () => {
    for (const input of [null, undefined, 42, 'x', []]) {
      const d = normalize(input)
      expect(Array.isArray(d.tasks)).toBe(true)
      expect(typeof d.habitLog).toBe('object')
    }
  })

  it('replaces fields of the wrong type and drops broken list entries', () => {
    const d = normalize({ name: 5, tasks: 'oops', habitLog: [], notes: [null, 3, { id: 'n1' }], cycleStart: '2026-01-05' })
    expect(d.tasks).toEqual([])
    expect(d.habitLog).toEqual({})
    expect(d.notes).toEqual([{ id: 'n1' }])
    expect(typeof d.name).toBe('string')
    expect(d.cycleStart).toBe('2026-01-05')
  })
})

import { useEffect, useState } from 'react'
import { Routine, habitRate, habitRoutine, useStore } from '../store'
import { addDays, fmtShort, today } from '../utils'
import { Check } from './ui'
import { locale, t as tr } from '../i18n'

/** Abhak-Liste der Habits eines Tages; optional nur Morgen- oder Abend-Habits */
export function HabitChecklist({ date, kind = 'good', routine }: { date: string; kind?: 'good' | 'bad'; routine?: Routine }) {
  const { db, update } = useStore()
  const habits = db.habits.filter(h => h.kind === kind && !h.archived && (!routine || habitRoutine(h) === routine))
  const done = db.habitLog[date] || []
  const toggle = (id: string, v: boolean) => update(d => {
    const cur = new Set(d.habitLog[date] || [])
    v ? cur.add(id) : cur.delete(id)
    d.habitLog[date] = [...cur]
  })
  const all = habits.length > 0 && habits.every(h => done.includes(h.id))
  return (
    <div className="habit-list">
      {kind === 'good' && (
        <button className="chip all-btn" onClick={() => update(d => {
          const cur = new Set(d.habitLog[date] || [])
          habits.forEach(h => all ? cur.delete(h.id) : cur.add(h.id))
          d.habitLog[date] = [...cur]
        })}>{all ? tr('Alle zurücksetzen') : tr('Alle abhaken')}</button>
      )}
      {habits.map(h => (
        <Check key={h.id} checked={done.includes(h.id)} onChange={v => toggle(h.id, v)} label={<><span className="hicon">{h.icon}</span>{h.name}</>} />
      ))}
    </div>
  )
}

export function HabitChart({ days = 30, height = 180 }: { days?: number; height?: number }) {
  const { db } = useStore()
  const t = today()
  const pts = Array.from({ length: days }, (_, i) => { const d = addDays(t, i - days + 1); return { d, v: habitRate(db, d) } })
  const W = 600, H = height, pl = 34, pr = 8, pt = 10, pb = 22
  const x = (i: number) => pl + (i * (W - pl - pr)) / (days - 1)
  const y = (v: number) => pt + (1 - v / 100) * (H - pt - pb)
  // weiche Kurve (Catmull-Rom → Bezier)
  let path = `M${x(0)},${y(pts[0].v)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = x(i) + (x(i + 1) - x(Math.max(0, i - 1))) / 6, c1y = y(p1.v) + (y(p2.v) - y(p0.v)) / 6
    const c2x = x(i + 1) - (x(Math.min(pts.length - 1, i + 2)) - x(i)) / 6, c2y = y(p2.v) - (y(p3.v) - y(p1.v)) / 6
    path += ` C${c1x},${clampY(c1y)} ${c2x},${clampY(c2y)} ${x(i + 1)},${y(p2.v)}`
  }
  function clampY(v: number) { return Math.max(pt, Math.min(H - pb, v)) }
  const avg = Math.round(pts.reduce((s, p) => s + p.v, 0) / pts.length)
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="chart">
      <div className="chart-head"><span>{tr('Ø {avg} % der letzten {days} Tage', { avg, days })}</span><span className="muted">{tr('Heute: {v} %', { v: pts[pts.length - 1].v })}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Habit-Quote pro Tag')} onMouseLeave={() => setHover(null)}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pl - 6} y={y(v) + 3} className="axis" textAnchor="end">{v}%</text>
          </g>
        ))}
        <path d={`${path} L${x(days - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="area" />
        <path d={path} className="line" />
        {pts.map((p, i) => (
          <g key={p.d}>
            {i % Math.ceil(days / 6) === 0 && <text x={x(i)} y={H - 6} className="axis" textAnchor="middle">{fmtShort(p.d)}</text>}
            <rect x={x(i) - (W / days) / 2} y={0} width={W / days} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            {hover === i && <><circle cx={x(i)} cy={y(p.v)} r={4} className="dot" />
              <text x={Math.min(Math.max(x(i), pl + 30), W - 40)} y={Math.max(y(p.v) - 10, 12)} className="tip" textAnchor="middle">{fmtShort(p.d)}: {p.v}%</text></>}
          </g>
        ))}
      </svg>
    </div>
  )
}

export function HabitWeekGrid({ weekStart }: { weekStart: string }) {
  const { db, update } = useStore()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const habits = db.habits.filter(h => !h.archived)
  const t = today()
  return (
    <div className="table-wrap">
      <table className="habit-grid">
        <thead>
          <tr>
            <th>{tr('Gewohnheit')}</th>
            {days.map(d => <th key={d} className={d === t ? 'is-today' : ''}>{new Date(d + 'T00:00').toLocaleDateString(locale(), { weekday: 'short' })}<br /><span className="muted">{fmtShort(d)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {habits.map(h => (
            <tr key={h.id} className={h.kind === 'bad' ? 'bad' : ''}>
              <td><span className="hicon">{h.icon}</span>{h.name}</td>
              {days.map(d => {
                const on = (db.habitLog[d] || []).includes(h.id)
                return (
                  <td key={d} className={d === t ? 'is-today' : ''}>
                    <Check checked={on} strike={false} onChange={v => update(x => {
                      const cur = new Set(x.habitLog[d] || []); v ? cur.add(h.id) : cur.delete(h.id); x.habitLog[d] = [...cur]
                    })} />
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="sum">
            <td>{tr('Quote (gute)')}</td>
            {days.map(d => <td key={d} className={d === t ? 'is-today' : ''}>{habitRate(db, d)}%</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

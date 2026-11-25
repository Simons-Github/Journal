import { Router } from 'express'
import type { Prisma } from './generated/prisma/client.js'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth } from './auth.js'
import { HttpError, handler } from './http.js'

/** Höchstens so viele Sicherungen pro Nutzer aufbewahren */
const KEEP_VERSIONS = 50
/** Automatische Sicherung höchstens alle 10 Minuten */
const AUTO_SNAPSHOT_MS = 10 * 60_000
/** Vercel-Functions akzeptieren max. 4,5 MB Request-Body */
const MAX_BYTES = 4 * 1024 * 1024

type Tx = Prisma.TransactionClient
type Row = { data: Prisma.JsonValue; version: number; updatedAt: Date }
const dto = (w: Row) => ({ data: w.data, version: w.version, updatedAt: w.updatedAt })

async function snapshot(tx: Tx, userId: string, current: Row, reason: string | undefined) {
  if (!reason) {
    const last = await tx.workspaceVersion.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    if (last && Date.now() - last.createdAt.getTime() < AUTO_SNAPSHOT_MS) return
  }
  await tx.workspaceVersion.create({
    data: { userId, version: current.version, data: current.data as Prisma.InputJsonValue, reason: reason || 'Automatische Sicherung' },
  })
  const old = await tx.workspaceVersion.findMany({
    where: { userId }, orderBy: { createdAt: 'desc' }, skip: KEEP_VERSIONS, select: { id: true },
  })
  if (old.length) await tx.workspaceVersion.deleteMany({ where: { id: { in: old.map(o => o.id) } } })
}

/** Grundstruktur prüfen, damit beschädigte Clients keine kaputten Daten speichern */
const COLLECTIONS = ['habits', 'days', 'evenings', 'weeks', 'areas', 'resources', 'goals', 'projects', 'tasks', 'notes', 'books', 'fog', 'timetable'] as const
const workspaceData = z.record(z.string(), z.unknown()).superRefine((d, ctx) => {
  for (const key of COLLECTIONS) {
    if (key in d && !Array.isArray(d[key])) ctx.addIssue({ code: 'custom', message: `Ungültiger Workspace: „${key}“ muss eine Liste sein` })
  }
  if ('habitLog' in d && (typeof d.habitLog !== 'object' || d.habitLog === null || Array.isArray(d.habitLog))) {
    ctx.addIssue({ code: 'custom', message: 'Ungültiger Workspace: „habitLog“ muss ein Objekt sein' })
  }
})

const putSchema = z.object({
  data: workspaceData,
  baseVersion: z.number().int().min(0),
  force: z.boolean().optional(),
  /** Grund für eine Sicherung des vorherigen Stands (z. B. „Import“) */
  snapshot: z.string().max(80).optional(),
})

export const workspaceRouter = Router()
workspaceRouter.use(requireAuth)

workspaceRouter.get('/', handler(async (req, res) => {
  const w = await prisma.workspace.findUnique({ where: { userId: req.userId } })
  res.json(w ? dto(w) : null)
}))

workspaceRouter.put('/', handler(async (req, res) => {
  const { data, baseVersion, force, snapshot: reason } = putSchema.parse(req.body)
  if (JSON.stringify(data).length > MAX_BYTES) throw new HttpError(413, 'Workspace ist zu groß (max. 4 MB)')
  const userId = req.userId!

  const result = await prisma.$transaction(async tx => {
    const current = await tx.workspace.findUnique({ where: { userId } })
    if (!current) {
      return { ok: true as const, w: await tx.workspace.create({ data: { userId, data: data as Prisma.InputJsonValue } }) }
    }
    if (!force && current.version !== baseVersion) return { ok: false as const, w: current }
    await snapshot(tx, userId, current, reason)
    const w = await tx.workspace.update({
      where: { userId },
      data: { data: data as Prisma.InputJsonValue, version: current.version + 1 },
    })
    return { ok: true as const, w }
  })

  if (!result.ok) {
    throw new HttpError(409, 'Der Workspace wurde auf einem anderen Gerät geändert', { workspace: dto(result.w) })
  }
  res.json(dto(result.w))
}))

workspaceRouter.get('/versions', handler(async (req, res) => {
  // Größe und Zähler direkt in Postgres berechnen, statt alle Stände zu laden
  const rows = await prisma.$queryRaw<{ id: string; version: number; reason: string; createdAt: Date; bytes: number; tasks: number; notes: number }[]>`
    SELECT id, version, reason, created_at AS "createdAt",
           pg_column_size(data)::int AS bytes,
           COALESCE(jsonb_array_length(data->'tasks'), 0)::int AS tasks,
           COALESCE(jsonb_array_length(data->'notes'), 0)::int AS notes
    FROM workspace_versions WHERE user_id = ${req.userId}
    ORDER BY created_at DESC`
  res.json(rows)
}))

workspaceRouter.post('/restore', handler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.body)
  const userId = req.userId!
  const w = await prisma.$transaction(async tx => {
    const v = await tx.workspaceVersion.findFirst({ where: { id, userId } })
    if (!v) throw new HttpError(404, 'Sicherung nicht gefunden')
    const current = await tx.workspace.findUnique({ where: { userId } })
    if (!current) return tx.workspace.create({ data: { userId, data: v.data as Prisma.InputJsonValue } })
    await snapshot(tx, userId, current, 'Vor Wiederherstellung')
    return tx.workspace.update({
      where: { userId },
      data: { data: v.data as Prisma.InputJsonValue, version: current.version + 1 },
    })
  })
  res.json(dto(w))
}))

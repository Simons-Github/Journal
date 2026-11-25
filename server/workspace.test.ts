import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import jwt from 'jsonwebtoken'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Runs the real Express app against an in-memory stand-in for Prisma,
 * so the sync rules (conflicts, size limit, backups) are tested end to end over HTTP.
 */
const fake = vi.hoisted(() => {
  type Workspace = { userId: string; data: unknown; version: number; updatedAt: Date }
  type Version = { id: string; userId: string; version: number; data: unknown; reason: string; createdAt: Date; seq: number }
  type Where = { userId: string; id?: string }

  const state = { workspaces: new Map<string, Workspace>(), versions: [] as Version[], seq: 0 }
  // Newest first; insertion order breaks ties between backups created in the same millisecond
  const newestFirst = (a: Version, b: Version) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq
  const versionsOf = (where: Where) =>
    state.versions.filter(v => v.userId === where.userId && (!where.id || v.id === where.id)).sort(newestFirst)

  const tx = {
    workspace: {
      findUnique: async ({ where }: { where: Where }) => state.workspaces.get(where.userId) ?? null,
      create: async ({ data }: { data: { userId: string; data: unknown } }) => {
        const w = { userId: data.userId, data: data.data, version: 1, updatedAt: new Date() } // version defaults to 1 in the schema
        state.workspaces.set(w.userId, w)
        return w
      },
      update: async ({ where, data }: { where: Where; data: { data: unknown; version: number } }) => {
        const w = { ...state.workspaces.get(where.userId)!, ...data, updatedAt: new Date() }
        state.workspaces.set(w.userId, w)
        return w
      },
    },
    workspaceVersion: {
      findFirst: async ({ where }: { where: Where }) => versionsOf(where)[0] ?? null,
      findMany: async ({ where, skip = 0 }: { where: Where; skip?: number }) => versionsOf(where).slice(skip),
      create: async ({ data }: { data: Omit<Version, 'id' | 'createdAt' | 'seq'> }) => {
        const seq = ++state.seq
        const v = { ...data, id: `v${seq}`, createdAt: new Date(), seq }
        state.versions.push(v)
        return v
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const before = state.versions.length
        state.versions = state.versions.filter(v => !where.id.in.includes(v.id))
        return { count: before - state.versions.length }
      },
    },
  }
  const prisma = { ...tx, $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) }
  return { state, prisma }
})

vi.mock('./db.js', () => ({ prisma: fake.prisma }))

const SECRET = 'test-secret-that-is-at-least-32-chars'
const USER = 'user-1'
const MB = 1024 * 1024
let server: Server
let base: string
let cookie: string

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', SECRET)
  const { default: app } = await import('./app.js')
  server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  cookie = `wm_session=${jwt.sign({ sub: USER }, SECRET)}`
})
afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  vi.unstubAllEnvs()
})

beforeEach(() => {
  fake.state.workspaces.clear()
  fake.state.versions = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-10T08:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

const minutes = (n: number) => vi.setSystemTime(Date.now() + n * 60_000)

async function put(body: Record<string, unknown>, headers: Record<string, string> = { Cookie: cookie }) {
  const res = await fetch(`${base}/api/workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  type Dto = { data: unknown; version: number; workspace: { data: unknown; version: number } }
  return { status: res.status, body: await res.json() as Dto }
}

/** Creates the workspace and returns its version */
async function seed(data: Record<string, unknown> = { tasks: [] }) {
  const r = await put({ data, baseVersion: 0 })
  expect(r.status).toBe(200)
  return r.body.version
}

describe('PUT /api/workspace', () => {
  it('requires a session', async () => {
    expect((await put({ data: {}, baseVersion: 0 }, {})).status).toBe(401)
  })

  it('creates the workspace and increments the version on each save', async () => {
    expect(await seed()).toBe(1)
    const r = await put({ data: { tasks: [{ id: 't1' }] }, baseVersion: 1 })
    expect(r.status).toBe(200)
    expect(r.body.version).toBe(2)
    expect(r.body.data).toEqual({ tasks: [{ id: 't1' }] })
  })

  it('answers 409 with the current server state when the client is behind', async () => {
    await seed({ tasks: [{ id: 'server' }] })
    await put({ data: { tasks: [{ id: 'device-a' }] }, baseVersion: 1 })

    const stale = await put({ data: { tasks: [{ id: 'device-b' }] }, baseVersion: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.workspace.version).toBe(2)
    expect(stale.body.workspace.data).toEqual({ tasks: [{ id: 'device-a' }] })
    // Nothing was overwritten
    expect(fake.state.workspaces.get(USER)?.data).toEqual({ tasks: [{ id: 'device-a' }] })
  })

  it('lets the client overwrite a newer state on purpose with force', async () => {
    await seed()
    await put({ data: { tasks: [{ id: 'device-a' }] }, baseVersion: 1 })
    const r = await put({ data: { tasks: [{ id: 'device-b' }] }, baseVersion: 1, force: true })
    expect(r.status).toBe(200)
    expect(r.body.version).toBe(3)
    expect(r.body.data).toEqual({ tasks: [{ id: 'device-b' }] })
  })

  it('rejects workspaces over 4 MB without saving them', async () => {
    await seed({ tasks: [], notes: [] })
    const tooBig = { notes: [{ id: 'n', content: 'x'.repeat(4 * MB) }] }
    const r = await put({ data: tooBig, baseVersion: 1 })
    expect(r.status).toBe(413)
    expect(fake.state.workspaces.get(USER)?.version).toBe(1)

    const justFits = { notes: [{ id: 'n', content: 'x'.repeat(4 * MB - 100) }] }
    expect((await put({ data: justFits, baseVersion: 1 })).status).toBe(200)
  })

  it('rejects workspaces with a broken structure', async () => {
    const r = await put({ data: { tasks: 'not a list' }, baseVersion: 0 })
    expect(r.status).toBe(422)
    expect(fake.state.workspaces.size).toBe(0)
  })
})

describe('backups', () => {
  it('backs up the previous state automatically at most every 10 minutes', async () => {
    let v = await seed()
    const save = async () => { v = (await put({ data: { tasks: [], v }, baseVersion: v })).body.version }

    await save()
    expect(fake.state.versions).toHaveLength(1)
    expect(fake.state.versions[0]).toMatchObject({ version: 1, reason: 'Automatische Sicherung' })

    minutes(9)
    await save()
    expect(fake.state.versions).toHaveLength(1)

    minutes(2) // 11 minutes after the last backup
    await save()
    expect(fake.state.versions).toHaveLength(2)
    expect(fake.state.versions[1].version).toBe(3)
  })

  it('always backs up before a named save such as an import', async () => {
    let v = await seed()
    v = (await put({ data: { tasks: [] }, baseVersion: v })).body.version
    await put({ data: { tasks: [] }, baseVersion: v, snapshot: 'Import' })
    expect(fake.state.versions.map(x => x.reason)).toEqual(['Automatische Sicherung', 'Import'])
  })

  it('keeps only the newest 50 backups', async () => {
    let v = await seed()
    for (let i = 0; i < 60; i++) {
      minutes(1)
      v = (await put({ data: { tasks: [] }, baseVersion: v, snapshot: 'Import' })).body.version
    }
    expect(v).toBe(61)
    const kept = fake.state.versions.map(x => x.version).sort((a, b) => a - b)
    expect(kept).toHaveLength(50)
    expect(kept[0]).toBe(11)
    expect(kept.at(-1)).toBe(60)
  })
})

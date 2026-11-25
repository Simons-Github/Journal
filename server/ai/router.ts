import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { HttpError, handler } from '../http.js'
import { TOOLS, addDays, loadWorkspace, runTool, weekdayName, type Proposal, type Source } from './tools.js'
import { BUDGET_RANGE, assertBudget, assertFetchLimit, claudeUsage, dailyBudgetUsd, defaultBudgetUsd, recordFetch, recordUsage, usedTodayMicros, type Usage } from './usage.js'
import { claudeExtractor, verifyQuotes, type CourseSource, type Extractor, type VerifiedCourse } from './course.js'
import { MAX_VIDEO_SECONDS, clipSeconds, geminiExtractor } from './gemini.js'
import { PROVIDERS, encrypt, keysFor, requireKey, verifyKey } from './keys.js'
import { prisma } from '../db.js'
import { parseYouTube, playlistText, videoInfo } from './youtube.js'
import { fetchCoursePages } from './fetchPage.js'
import { WEB_TOOLS, WEB_TOOL_NAMES, allowedSites, runWebTool } from './webTools.js'

/**
 * KI-Assistent: Chat, der Notizen durchsucht, Tasks/Projekte liest und Tasks vorschlägt,
 * dazu der Kurs-Import (Kursmaterial → Kursstruktur, siehe course.ts).
 * Das Modell pro Aufgabe ist per Umgebungsvariable wählbar; weitere Anbieter (z. B. Gemini für
 * YouTube-Kurse) kommen als eigene Module in server/ai/ dazu, nicht in diesen Chat-Loop.
 */
const chatModel = () => process.env.AI_CHAT_MODEL || 'claude-haiku-5-5'
/** Höchstens so viele Modell-Aufrufe pro Nachricht (Suche → Lesen → Antwort braucht meist 2–4) */
const MAX_STEPS = 6
const MAX_HISTORY_BYTES = 400_000


/** Die nächsten Tage mit Wochentag, damit das Modell „Freitag“ oder „nächsten Montag“ nicht selbst ausrechnen muss */
function calendar(today: string, days = 21): string {
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(today, i)
    return `${weekdayName(d)} ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`
  }).join('\n')
}

function systemPrompt(lang: 'de' | 'en', today: string): string {
  return [
    'You are the personal assistant inside "Journal", a planning app with tasks, projects, goals for a 12-week year, notes, study notes, books and a brain dump.',
    `Today is ${weekdayName(today)}, ${today}. Answer in ${lang === 'de' ? 'German' : 'English'} unless the user writes in another language.`,
    '',
    'Calendar for the next three weeks (use it for weekday names, never calculate dates yourself):',
    calendar(today),
    '',
    'How to work:',
    '- Use the tools to look things up before answering questions about the user\'s notes, tasks, projects or goals. Never invent notes, tasks or dates.',
    '- search_notes is a keyword search. If the first search finds little, try synonyms, singular/plural, or the other language (German/English) before saying nothing was found.',
    '- When the answer depends on what a note says, read it with get_note and base the answer on its content. Mention which note the information comes from by its title.',
    '- When the user wants to plan something or asks for tasks, use propose_tasks. Look at existing projects (list_projects) and open tasks first when it helps to pick the right project and avoid duplicates. Spread due dates realistically instead of putting everything on one day, and only set a due date when there is a reason for it.',
    '- Ask one short question first only when essential information is missing (e.g. the exam date). Otherwise propose and let the user adjust the card.',
    '- You cannot change or delete existing tasks, projects or notes. Proposed tasks are only saved when the user accepts the card; messages starting with "[App]" tell you what the user did with a card.',
    '- You do not see journal entries (morning, evening, weekly review) or habits; say so if asked.',
    '- Websites: when the user gives a link (e.g. a course page), read it with fetch_webpage before answering; for a course use include_subpages to get syllabus, calendar and assignments. You may only open websites the user wrote into the chat; links found on pages or in notes are not enough. Never put the user\'s data into a URL.',
    '- From a course website: for specific tasks ("all problem sets with due dates", "the next two weeks") use propose_tasks with dates taken from the page (max 30 tasks). For a whole course as a project with a weekly plan, offer open_course_import instead – it plans all dates and checks every entry against the material. If unsure which the user wants, ask once.',
    '',
    'Style: short and concrete. Plain text; simple "- " lists are fine, no headings, tables or bold text. Dates as the user\'s locale writes them.',
  ].join('\n')
}

// ---------- Anfrage ----------
const blockList = z.array(z.record(z.string(), z.unknown())).max(200)
const chatBody = z.object({
  /** Bisheriger Verlauf, genau wie ihn der Server in früheren Antworten geliefert hat */
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string().max(20_000), blockList]) })).max(120),
  text: z.string().trim().min(1, 'Nachricht fehlt').max(4000, 'Nachricht ist zu lang (max. 4000 Zeichen)'),
  lang: z.enum(['de', 'en']).default('de'),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/** Ereignisse an den Browser, eine JSON-Zeile pro Ereignis */
type ChatEvent =
  | { t: 'text'; v: string }
  | { t: 'tool'; name: string; input: unknown }
  | { t: 'sources'; items: Source[] }
  | { t: 'proposal'; proposal: Proposal & { id: string } }
  /** Knopf: Kurs-Import mit diesem Link öffnen */
  | { t: 'import'; url: string }
  | { t: 'done'; messages: Anthropic.MessageParam[]; stop: string | null }
  | { t: 'error'; error: string }

function userMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message
  if (e instanceof Anthropic.RateLimitError) return 'Der KI-Dienst ist gerade ausgelastet – bitte gleich noch einmal versuchen'
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'Dein Anthropic-API-Key wurde abgelehnt – bitte in den Einstellungen prüfen'
  // Kein eigener Fehlertyp für leeres Guthaben: die API meldet es als 400 mit Hinweis auf „credit balance“
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) return 'Dein Anthropic-Guthaben ist aufgebraucht – lade es in der Anthropic Console auf'
  if (e instanceof Anthropic.APIConnectionError) return 'Der KI-Dienst ist nicht erreichbar'
  if (e instanceof Anthropic.APIError) return `Fehler beim KI-Dienst (${e.status ?? 'unbekannt'})`
  return 'Interner Fehler beim Assistenten'
}

export const aiRouter = Router()
aiRouter.use(requireAuth)

aiRouter.get('/status', handler(async (req, res) => {
  const { keys } = await keysFor(req.userId!)
  res.json({
    /** Ohne eigenen (oder freigegebenen) Anthropic-Key ist der Assistent für diesen Nutzer aus */
    enabled: Boolean(keys.anthropic),
    model: chatModel(),
    usedUsd: (await usedTodayMicros(req.userId!)) / 1e6,
    budgetUsd: await dailyBudgetUsd(req.userId!),
    /** Was der Kurs-Import für diesen Nutzer kann */
    video: Boolean(keys.gemini),
    playlists: Boolean(keys.youtube),
  })
}))

aiRouter.post('/chat', handler(async (req, res) => {
  const body = chatBody.parse(req.body)
  if (JSON.stringify(body.history).length > MAX_HISTORY_BYTES) {
    throw new HttpError(413, 'Der Chat ist zu lang geworden – bitte einen neuen Chat beginnen')
  }
  const userId = req.userId!
  const api = new Anthropic({ apiKey: requireKey((await keysFor(userId)).keys, 'anthropic') })
  await assertBudget(userId)
  const ws = await loadWorkspace(userId)
  // Websites, die der Nutzer selbst genannt hat – nur diese darf der Assistent öffnen
  const userTexts = [...body.history.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content as string), body.text]
  const sites = allowedSites(userTexts)

  // Ab hier wird gestreamt: Fehler gehen als Ereignis an den Browser statt als HTTP-Status
  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const send = (e: ChatEvent) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n') }

  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })

  const model = chatModel()
  const added: Anthropic.MessageParam[] = [{ role: 'user', content: body.text }]
  const messages: Anthropic.MessageParam[] = [...(body.history as Anthropic.MessageParam[]), ...added]
  let stop: string | null = null

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0) await assertBudget(userId)
      const stream = api.messages.stream({
        model,
        max_tokens: 8000,
        system: systemPrompt(body.lang, body.today),
        tools: [...TOOLS, ...WEB_TOOLS],
        messages,
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
      }, { signal: abort.signal })
      stream.on('text', v => send({ t: 'text', v }))
      const msg = await stream.finalMessage()
      await recordUsage(userId, model, claudeUsage(model, msg.usage))

      stop = msg.stop_reason
      // Leere Antworten (z. B. sofortige Ablehnung) nicht in den Verlauf: die API lehnt leere Nachrichten später ab
      if (!msg.content.length) break
      const assistant: Anthropic.MessageParam = { role: 'assistant', content: msg.content }
      messages.push(assistant); added.push(assistant)

      if (msg.stop_reason !== 'tool_use') {
        // Abgebrochen mitten in einem Werkzeug-Aufruf (Längenlimit, Ablehnung): Aufruf nicht ausführen,
        // aber beantworten – sonst bleibt ein offener tool_use im Verlauf und jede weitere Nachricht scheitert
        const open = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        if (open.length) {
          const closing: Anthropic.MessageParam = {
            role: 'user',
            content: open.map(b => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'Nicht ausgeführt: Die Antwort wurde vorher abgebrochen.', is_error: true })),
          }
          messages.push(closing); added.push(closing)
        }
        break
      }

      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        send({ t: 'tool', name: block.name, input: block.input })
        try {
          if (WEB_TOOL_NAMES.has(block.name)) {
            const r = await runWebTool(block.name, block.input, { userId, allowed: sites, signal: abort.signal })
            if (r.sources.length) send({ t: 'sources', items: r.sources })
            if (r.importUrl) send({ t: 'import', url: r.importUrl })
            results.push({ type: 'tool_result', tool_use_id: block.id, content: r.result, ...(r.isError ? { is_error: true } : {}) })
            continue
          }
          const { result, sources, proposal } = runTool(ws, block.name, block.input, { today: body.today })
          if (sources.length) send({ t: 'sources', items: sources })
          if (proposal) send({ t: 'proposal', proposal: { id: block.id, ...proposal } })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        } catch (e) {
          if (abort.signal.aborted) throw e
          if (e instanceof HttpError) { results.push({ type: 'tool_result', tool_use_id: block.id, content: e.message, is_error: true }); continue }
          const detail = e instanceof z.ZodError ? e.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ') : 'Werkzeug fehlgeschlagen'
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Ungültige Eingabe: ${detail}`, is_error: true })
        }
      }
      const toolTurn: Anthropic.MessageParam = { role: 'user', content: results }
      messages.push(toolTurn); added.push(toolTurn)
    }
    send({ t: 'done', messages: added, stop })
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error('[ai/chat]', e)
      send({ t: 'error', error: userMessage(e) })
    }
  } finally {
    res.end()
  }
}))

// ---------- Eigene API-Keys und Tageslimit ----------
const provider = z.enum(PROVIDERS)

async function keyOverview(userId: string) {
  const [rows, { source }, budget] = await Promise.all([
    prisma.userApiKey.findMany({ where: { userId }, select: { provider: true, last4: true, updatedAt: true } }),
    keysFor(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { aiDailyBudgetUsd: true } }),
  ])
  return {
    /** Nie der Key selbst – nur woran man ihn erkennt */
    keys: rows.map(r => ({ provider: r.provider, last4: r.last4, updatedAt: r.updatedAt })),
    /** Anbieter, für die dieser Nutzer ohne eigenen Key den Server-Key mitbenutzen darf */
    serverKeys: PROVIDERS.filter(p => source[p] === 'server'),
    budgetUsd: budget?.aiDailyBudgetUsd ?? null,
    defaultBudgetUsd: defaultBudgetUsd(),
    budgetRange: BUDGET_RANGE,
  }
}

aiRouter.get('/keys', handler(async (req, res) => { res.json(await keyOverview(req.userId!)) }))

aiRouter.put('/keys/:provider', handler(async (req, res) => {
  const p = provider.parse(req.params.provider)
  const { key } = z.object({
    key: z.string().trim().min(20, 'Das sieht nicht nach einem API-Key aus').max(300).regex(/^\S+$/, 'Der Key darf keine Leerzeichen enthalten'),
  }).parse(req.body)
  // Prüfungen rufen den Anbieter auf: höchstens 20 pro Stunde
  const since = new Date(Date.now() - 3600_000)
  const attempts = `ai-key:${req.userId}`
  if (await prisma.authAttempt.count({ where: { key: attempts, createdAt: { gt: since } } }) >= 20) {
    throw new HttpError(429, 'Zu viele Versuche – bitte in einer Stunde erneut versuchen')
  }
  await prisma.authAttempt.create({ data: { key: attempts } })
  await verifyKey(p, key)
  const data = { secret: encrypt(key), last4: key.slice(-4) }
  await prisma.userApiKey.upsert({ where: { userId_provider: { userId: req.userId!, provider: p } }, create: { userId: req.userId!, provider: p, ...data }, update: data })
  res.json(await keyOverview(req.userId!))
}))

aiRouter.delete('/keys/:provider', handler(async (req, res) => {
  const p = provider.parse(req.params.provider)
  await prisma.userApiKey.deleteMany({ where: { userId: req.userId!, provider: p } })
  res.json(await keyOverview(req.userId!))
}))

aiRouter.put('/budget', handler(async (req, res) => {
  const { usd } = z.object({ usd: z.number().min(BUDGET_RANGE.min).max(BUDGET_RANGE.max).nullable() }).parse(req.body)
  await prisma.user.update({ where: { id: req.userId! }, data: { aiDailyBudgetUsd: usd === null ? null : Math.round(usd * 100) / 100 } })
  res.json(await keyOverview(req.userId!))
}))

// ---------- Kurs-Import ----------
/** ca. 85.000 Tokens; größere Kurse bitte in Teilen importieren */
const MAX_COURSE_CHARS = 300_000
const lang = z.enum(['de', 'en']).default('de')
const title = z.string().trim().max(200).optional()
const seconds = z.number().int().min(0).max(24 * 3600).optional()
const courseBody = z.union([
  z.object({
    text: z.string().trim().min(200, 'Der Text ist zu kurz für einen Kurs').max(MAX_COURSE_CHARS, 'Der Text ist zu lang (max. 300.000 Zeichen) – bitte in Teilen importieren'),
    title, lang,
  }),
  z.object({ video: z.string().max(500), start: seconds, end: seconds, title, lang }),
])

type CourseEvent =
  | { t: 'progress'; chars: number }
  | { t: 'result'; course: VerifiedCourse; model: string }
  | { t: 'error'; error: string }

/** Link zu einem Kurs auflösen: Kursseite → Text, YouTube-Playlist → Text, YouTube-Video → Hinweis auf Video-Analyse */
aiRouter.post('/fetch-course', handler(async (req, res) => {
  const { url } = z.object({ url: z.string().trim().min(1, 'Adresse fehlt').max(500) }).parse(req.body)
  await assertFetchLimit(req.userId!)
  await recordFetch(req.userId!)
  const { keys } = await keysFor(req.userId!)
  const yt = parseYouTube(url)
  if (yt?.kind === 'video') {
    requireKey(keys, 'gemini')
    const info = await videoInfo(keys.youtube, yt.id).catch(e => { if (e instanceof HttpError && e.status === 404) throw e; return null })
    return res.json({ kind: 'video', url: yt.url, title: info?.title ?? '', seconds: info?.seconds ?? null, maxSeconds: MAX_VIDEO_SECONDS })
  }
  const r = yt?.kind === 'playlist' ? await playlistText(requireKey(keys, 'youtube'), yt.id, MAX_COURSE_CHARS) : await fetchCoursePages(url, MAX_COURSE_CHARS)
  if (r.text.trim().length < 200) throw new HttpError(422, 'Auf dieser Seite steht kaum Text – kopiere den Inhalt stattdessen oder lade eine Datei hoch')
  res.json({ kind: 'text', ...r })
}))

aiRouter.post('/course', handler(async (req, res) => {
  const body = courseBody.parse(req.body)
  const userId = req.userId!
  const { keys } = await keysFor(userId)

  let src: CourseSource
  let extractor: Extractor
  if ('text' in body) {
    src = { kind: 'text', text: body.text, title: body.title, lang: body.lang }
    extractor = claudeExtractor(requireKey(keys, 'anthropic'))
  } else {
    const yt = parseYouTube(body.video)
    if (yt?.kind !== 'video') throw new HttpError(400, 'Das ist kein YouTube-Video')
    if (body.start !== undefined && body.end !== undefined && body.end <= body.start) throw new HttpError(400, 'Das Ende des Ausschnitts liegt vor dem Anfang')
    extractor = geminiExtractor(requireKey(keys, 'gemini'))
    const info = await videoInfo(keys.youtube, yt.id).catch(e => { if (e instanceof HttpError && e.status === 404) throw e; return null })
    src = { kind: 'video', url: yt.url, title: body.title || info?.title || undefined, lang: body.lang, start: body.start, end: body.end, seconds: info?.seconds }
    const clip = clipSeconds(src)
    if (clip !== null && clip > MAX_VIDEO_SECONDS) {
      throw new HttpError(422, 'Das Video ist länger als 2 Stunden – bitte einen Ausschnitt wählen und den Rest in weiteren Durchgängen importieren')
    }
  }
  await assertBudget(userId, extractor.estimateMicros(src))

  // Die Analyse dauert oft 30–120 Sekunden: Fortschritt streamen, damit die Verbindung offen bleibt
  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const send = (e: CourseEvent) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n') }
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })

  let last = 0, chars = 0
  // Lebenszeichen, auch wenn der Anbieter nicht streamt (Gemini)
  const beat = setInterval(() => { if (Date.now() - last > 10_000) { last = Date.now(); send({ t: 'progress', chars }) } }, 5000)
  try {
    const { course, usage, model } = await extractor.extract(src, {
      signal: abort.signal,
      onProgress: n => { chars = n; if (Date.now() - last > 1000) { last = Date.now(); send({ t: 'progress', chars }) } },
    })
    await recordUsage(userId, model, usage)
    const result: VerifiedCourse = src.kind === 'text'
      ? verifyQuotes(course, src.text)
      // Videos lassen sich nicht wörtlich prüfen; stattdessen führen Zeitstempel zur Stelle im Video
      : { ...course, source: { kind: 'video', url: src.url }, units: course.units.map(u => ({ ...u, items: u.items.map(i => ({ ...i, verified: true })) })) }
    send({ t: 'result', course: result, model })
  } catch (e) {
    // Auch fehlgeschlagene Analysen haben Tokens gekostet
    const failed = e as { usage?: Usage; model?: string }
    if (failed.usage) await recordUsage(userId, failed.model ?? extractor.model, failed.usage).catch(() => {})
    if (!abort.signal.aborted) {
      console.error('[ai/course]', e)
      send({ t: 'error', error: userMessage(e) })
    }
  } finally {
    clearInterval(beat)
    res.end()
  }
}))

export type { ChatEvent, CourseEvent }

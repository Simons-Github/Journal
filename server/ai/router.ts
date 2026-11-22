import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { HttpError, handler } from '../http.js'
import { TOOLS, addDays, loadWorkspace, runTool, weekdayName, type Proposal, type Source } from './tools.js'
import { assertBudget, dailyBudgetUsd, recordUsage, usedTodayMicros } from './usage.js'

/**
 * KI-Assistent (Phase 1): Chat, der Notizen durchsucht und Tasks/Projekte liest.
 * Das Modell pro Aufgabe ist per Umgebungsvariable wählbar; weitere Anbieter (z. B. Gemini für
 * YouTube-Kurse) kommen als eigene Module in server/ai/ dazu, nicht in diesen Chat-Loop.
 */
const chatModel = () => process.env.AI_CHAT_MODEL || 'claude-haiku-5-5'
/** Höchstens so viele Modell-Aufrufe pro Nachricht (Suche → Lesen → Antwort braucht meist 2–4) */
const MAX_STEPS = 6
const MAX_HISTORY_BYTES = 400_000

let client: Anthropic | null = null
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Der KI-Assistent ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt)')
  return (client ??= new Anthropic())
}

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
    '',
    'Style: short and concrete. Plain text; simple "- " lists are fine, no headings, tables or bold text. Dates as the user\'s locale writes them.',
  ].join('\n')
}

// ---------- Anfrage ----------
const blockList = z.array(z.record(z.unknown())).max(200)
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
  | { t: 'done'; messages: Anthropic.MessageParam[]; stop: string | null }
  | { t: 'error'; error: string }

function userMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message
  if (e instanceof Anthropic.RateLimitError) return 'Der KI-Dienst ist gerade ausgelastet – bitte gleich noch einmal versuchen'
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'Der API-Key für den KI-Dienst ist ungültig'
  if (e instanceof Anthropic.APIConnectionError) return 'Der KI-Dienst ist nicht erreichbar'
  if (e instanceof Anthropic.APIError) return `Fehler beim KI-Dienst (${e.status ?? 'unbekannt'})`
  return 'Interner Fehler beim Assistenten'
}

export const aiRouter = Router()
aiRouter.use(requireAuth)

aiRouter.get('/status', handler(async (req, res) => {
  res.json({
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    model: chatModel(),
    usedUsd: (await usedTodayMicros(req.userId!)) / 1e6,
    budgetUsd: dailyBudgetUsd(),
  })
}))

aiRouter.post('/chat', handler(async (req, res) => {
  const body = chatBody.parse(req.body)
  if (JSON.stringify(body.history).length > MAX_HISTORY_BYTES) {
    throw new HttpError(413, 'Der Chat ist zu lang geworden – bitte einen neuen Chat beginnen')
  }
  const userId = req.userId!
  const api = anthropic()
  await assertBudget(userId)
  const ws = await loadWorkspace(userId)

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
        tools: TOOLS,
        messages,
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
      }, { signal: abort.signal })
      stream.on('text', v => send({ t: 'text', v }))
      const msg = await stream.finalMessage()
      await recordUsage(userId, model, msg.usage)

      const assistant: Anthropic.MessageParam = { role: 'assistant', content: msg.content }
      messages.push(assistant); added.push(assistant)
      stop = msg.stop_reason

      if (msg.stop_reason !== 'tool_use') break

      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        send({ t: 'tool', name: block.name, input: block.input })
        try {
          const { result, sources, proposal } = runTool(ws, block.name, block.input, { today: body.today })
          if (sources.length) send({ t: 'sources', items: sources })
          if (proposal) send({ t: 'proposal', proposal: { id: block.id, ...proposal } })
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        } catch (e) {
          const detail = e instanceof z.ZodError ? e.errors.map(x => `${x.path.join('.')}: ${x.message}`).join('; ') : 'Werkzeug fehlgeschlagen'
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

export type { ChatEvent }

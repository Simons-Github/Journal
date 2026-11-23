import { HttpError } from '../http.js'
import { JSON_SCHEMA, courseSchema, videoInstructions, type Course, type Extractor } from './course.js'
import { priceOf, type Usage } from './usage.js'

/**
 * Gemini für YouTube-Videos: Das Modell sieht und hört das Video selbst (nur öffentliche Videos).
 * Schnittstelle: Gemini Interactions API (POST /v1beta/interactions), strukturierte Ausgabe über
 * `response_format` mit demselben JSON-Schema wie beim Claude-Import.
 */

const geminiModel = () => process.env.AI_VIDEO_MODEL || 'gemini-3.5-flash-lite'
const apiBase = () => process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'

/** Grobe Tokens pro Sekunde Video bei niedriger Auflösung (Bild ~100 + Ton ~32) */
const TOKENS_PER_SECOND = 132
/** Ohne bekannte Länge: eine Stunde annehmen */
const DEFAULT_SECONDS = 3600
/** Längere Abschnitte passen nicht sicher in den Kontext – dann in Teilen importieren */
export const MAX_VIDEO_SECONDS = 2 * 3600
const MAX_OUTPUT = 32_000

/** Länge des analysierten Abschnitts in Sekunden (oder null, wenn unbekannt) */
export function clipSeconds(src: { start?: number; end?: number; seconds?: number }): number | null {
  const end = src.end ?? src.seconds
  return end === undefined ? null : Math.max(0, end - (src.start ?? 0))
}

interface InteractionResponse {
  status?: string
  output_text?: string
  steps?: { type: string; content?: { type: string; text?: string }[] }[]
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number }
  error?: { message?: string; status?: string }
}

export function geminiExtractor(key: string): Extractor {
  const model = geminiModel()
  return {
    model,
    estimateMicros(src) {
      if (src.kind !== 'video') throw new HttpError(400, 'Gemini liest hier nur Videos')
      const p = priceOf(model)
      return Math.ceil((clipSeconds(src) ?? DEFAULT_SECONDS) * TOKENS_PER_SECOND * p.input + (MAX_OUTPUT / 2) * p.output)
    },
    async extract(src, { signal }) {
      if (src.kind !== 'video') throw new HttpError(400, 'Gemini liest hier nur Videos')
      const video: Record<string, unknown> = { type: 'video', uri: src.url }
      if (src.start !== undefined || src.end !== undefined) {
        video.processing = {
          type: 'static',
          ...(src.start !== undefined ? { start_offset: `${src.start}s` } : {}),
          ...(src.end !== undefined ? { end_offset: `${src.end}s` } : {}),
        }
      }
      let res: Response
      try {
        res = await fetch(`${apiBase()}/interactions`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            model,
            input: [
              { type: 'text', text: `${videoInstructions(src.lang)}${src.title ? `\n\nCourse title given by the user: ${src.title}` : ''}` },
              video,
            ],
            response_format: { type: 'text', mime_type: 'application/json', schema: JSON_SCHEMA },
            generation_config: { thinking_level: 'low', max_output_tokens: MAX_OUTPUT },
          }),
        })
      } catch (e) {
        if (signal.aborted) throw e
        throw new HttpError(502, 'Gemini ist nicht erreichbar')
      }
      const body = await res.json().catch(() => null) as InteractionResponse | null
      if (!res.ok || !body) {
        const msg = body?.error?.message ?? ''
        console.error('[ai/gemini]', res.status, msg)
        if (res.status === 400) throw new HttpError(400, 'Gemini konnte dieses Video nicht verarbeiten (nur öffentliche Videos; bei langen Videos einen Ausschnitt wählen)')
        if (res.status === 429) throw new HttpError(429, 'Gemini ist gerade ausgelastet oder das Kontingent ist aufgebraucht – bitte später erneut versuchen')
        if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Dein Gemini-API-Key wurde abgelehnt – bitte in den Einstellungen prüfen')
        throw new HttpError(502, `Fehler bei Gemini (${res.status})`)
      }

      const u = body.usage ?? {}
      const out = (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0) // Denken wird wie Ausgabe berechnet
      const p = priceOf(model)
      const usage: Usage = { inputTokens: u.total_input_tokens ?? 0, outputTokens: out, costMicros: Math.ceil((u.total_input_tokens ?? 0) * p.input + out * p.output) }

      const text = body.output_text
        ?? body.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
        ?? ''
      if (body.status === 'incomplete') {
        throw Object.assign(new HttpError(422, 'Das Video ist zu umfangreich für einen Durchgang – bitte einen kürzeren Ausschnitt wählen'), { usage, model })
      }
      let course: Course
      try {
        course = courseSchema.parse(JSON.parse(text))
      } catch {
        throw Object.assign(new HttpError(502, text ? 'Die Antwort von Gemini war unvollständig – bitte erneut versuchen' : 'Gemini hat keine Antwort geliefert (evtl. wurde das Video blockiert)'), { usage, model })
      }
      return { course, usage, model }
    },
  }
}

import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import { HttpError } from '../http.js'

/** Preise in US-Dollar pro 1 Mio. Tokens (Eingabe / Ausgabe), Stand November 2026 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  // Gemini (Video-Eingabe; Ausgabe inkl. Denk-Tokens). 3.8 Flash: Einführungspreis bis Ende 2026
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
}
/** Unbekanntes Modell: lieber zu hoch schätzen */
export const priceOf = (model: string) => PRICES[model] ?? PRICES['claude-opus-5-5']

/**
 * Tageslimit pro Nutzer in US-Dollar. Standard 1 $: reicht für Hunderte Chat-Nachrichten mit Haiku
 * und mehrere Kurs-Importe mit Sonnet (ein Kurs kostet meist 0,02–0,30 $).
 */
export function dailyBudgetUsd(): number {
  const v = Number(process.env.AI_DAILY_BUDGET_USD)
  return Number.isFinite(v) && v > 0 ? v : 1
}

/** Verbrauch einer Anfrage, unabhängig vom Anbieter */
export interface Usage { inputTokens: number; outputTokens: number; costMicros: number }

/** Claude: Cache-Lesen kostet 10 %, Cache-Schreiben 125 % der Eingabe */
export function claudeUsage(model: string, u: Anthropic.Usage | Anthropic.Beta.BetaUsage): Usage {
  const p = priceOf(model)
  const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0
  return {
    inputTokens: u.input_tokens + read + write,
    outputTokens: u.output_tokens,
    costMicros: Math.ceil((u.input_tokens + read * 0.1 + write * 1.25) * p.input + u.output_tokens * p.output),
  }
}

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export async function usedTodayMicros(userId: string): Promise<number> {
  const r = await prisma.aiUsage.aggregate({ where: { userId, createdAt: { gte: startOfDay() } }, _sum: { costMicros: true } })
  return r._sum.costMicros ?? 0
}

/** Prüft das Tageslimit; mit `estimateMicros` muss auch die geschätzte nächste Anfrage noch hineinpassen */
export async function assertBudget(userId: string, estimateMicros = 0) {
  const used = await usedTodayMicros(userId)
  const budget = dailyBudgetUsd() * 1e6
  if (used >= budget) throw new HttpError(429, 'Tageslimit des Assistenten erreicht – morgen geht es weiter')
  if (used + estimateMicros > budget) {
    throw new HttpError(429, 'Dafür reicht das restliche Tageslimit nicht – bitte morgen erneut versuchen oder den Text kürzen')
  }
}

export async function recordUsage(userId: string, model: string, u: Usage) {
  await prisma.aiUsage.create({ data: { userId, model, ...u } })
}

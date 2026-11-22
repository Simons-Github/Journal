import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../db.js'
import { HttpError } from '../http.js'

/** Preise in US-Dollar pro 1 Mio. Tokens (Eingabe / Ausgabe), Stand November 2026 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
}

/** Tageslimit pro Nutzer in US-Dollar (Standard 0,20 $ ≈ 150–200 Chat-Nachrichten mit Haiku) */
export function dailyBudgetUsd(): number {
  const v = Number(process.env.AI_DAILY_BUDGET_USD)
  return Number.isFinite(v) && v > 0 ? v : 0.2
}

/** Kosten einer Anfrage in Millionstel Dollar; Cache-Lesen kostet 10 %, Cache-Schreiben 125 % der Eingabe */
export function costMicros(model: string, u: Anthropic.Usage): number {
  const p = PRICES[model] ?? PRICES['claude-sonnet-5-5'] // unbekanntes Modell: lieber zu hoch schätzen
  const input = u.input_tokens + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25
  return Math.ceil(input * p.input + u.output_tokens * p.output)
}

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export async function usedTodayMicros(userId: string): Promise<number> {
  const r = await prisma.aiUsage.aggregate({ where: { userId, createdAt: { gte: startOfDay() } }, _sum: { costMicros: true } })
  return r._sum.costMicros ?? 0
}

export async function assertBudget(userId: string) {
  if (await usedTodayMicros(userId) >= dailyBudgetUsd() * 1e6) {
    throw new HttpError(429, 'Tageslimit des Assistenten erreicht – morgen geht es weiter')
  }
}

export async function recordUsage(userId: string, model: string, u: Anthropic.Usage) {
  await prisma.aiUsage.create({
    data: {
      userId, model,
      inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      costMicros: costMicros(model, u),
    },
  })
}

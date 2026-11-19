import type { NextFunction, Request, RequestHandler, Response } from 'express'

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message)
  }
}

/** Async-Handler, deren Fehler an die Express-Fehlerbehandlung weitergereicht werden */
export const handler = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next) }

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]
  return (first || req.socket.remoteAddress || 'unknown').trim()
}

export const isSecure = (req: Request) =>
  req.secure || req.headers['x-forwarded-proto'] === 'https'

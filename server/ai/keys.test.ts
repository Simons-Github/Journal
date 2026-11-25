import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../http.js'
import { decrypt, encrypt } from './keys.js'

vi.mock('../db.js', () => ({ prisma: {} }))

const SECRET_A = 'a'.repeat(32)
const SECRET_B = 'b'.repeat(32)

/** Flips one byte in the given part of a stored value (1 = IV, 2 = auth tag, 3 = ciphertext) */
function tamper(stored: string, part: 1 | 2 | 3): string {
  const parts = stored.split(':')
  const buf = Buffer.from(parts[part], 'base64')
  buf[0] ^= 0x01
  parts[part] = buf.toString('base64')
  return parts.join(':')
}

beforeEach(() => {
  vi.stubEnv('AI_KEYS_SECRET', SECRET_A)
  vi.stubEnv('JWT_SECRET', '')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('API key encryption (AES-256-GCM)', () => {
  it('round-trips keys, including non-ASCII text', () => {
    for (const plain of ['sk-ant-api03-abc123', 'AIzaSy-xyz', 'Schlüssel 🔑']) {
      expect(decrypt(encrypt(plain))).toBe(plain)
    }
  })

  it('stores a versioned value that does not contain the key', () => {
    const stored = encrypt('sk-ant-secret')
    expect(stored.split(':')).toHaveLength(4)
    expect(stored.startsWith('v1:')).toBe(true)
    expect(stored).not.toContain('sk-ant-secret')
  })

  it('uses a fresh IV for every encryption', () => {
    const a = encrypt('same key'), b = encrypt('same key')
    expect(a).not.toBe(b)
    expect(a.split(':')[1]).not.toBe(b.split(':')[1])
  })

  it('rejects tampered values', () => {
    const stored = encrypt('sk-ant-secret')
    expect(() => decrypt(tamper(stored, 1))).toThrow()
    expect(() => decrypt(tamper(stored, 2))).toThrow()
    expect(() => decrypt(tamper(stored, 3))).toThrow()
  })

  it('rejects unknown formats', () => {
    expect(() => decrypt('plain-text-key')).toThrow('unbekanntes Format')
    expect(() => decrypt(encrypt('x').replace(/^v1:/, 'v2:'))).toThrow('unbekanntes Format')
  })

  it('cannot decrypt with a different secret', () => {
    const stored = encrypt('sk-ant-secret')
    vi.stubEnv('AI_KEYS_SECRET', SECRET_B)
    expect(() => decrypt(stored)).toThrow()
  })

  it('falls back to a key derived from JWT_SECRET, which differs from the secret itself', () => {
    vi.stubEnv('AI_KEYS_SECRET', '')
    vi.stubEnv('JWT_SECRET', SECRET_A)
    const stored = encrypt('sk-ant-secret')
    expect(decrypt(stored)).toBe('sk-ant-secret')
    // The same string used as AI_KEYS_SECRET yields a different key
    vi.stubEnv('AI_KEYS_SECRET', SECRET_A)
    expect(() => decrypt(stored)).toThrow()
  })

  it('refuses to work without a long enough secret', () => {
    vi.stubEnv('AI_KEYS_SECRET', 'too-short')
    vi.stubEnv('JWT_SECRET', 'also-too-short')
    let err: unknown
    try { encrypt('x') } catch (e) { err = e }
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(500)
  })
})

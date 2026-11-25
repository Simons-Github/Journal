import dns from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../http.js'
import { checkUrl, fetchPage, isPrivateIp } from './fetchPage.js'

afterEach(() => { vi.restoreAllMocks() })

describe('isPrivateIp', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.1.2.3',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'feb0::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::FFFF:C0A8:0101',
  ])('treats %s as private', ip => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.169.0.1', '198.20.0.1',
    '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '::ffff:808:808',
  ])('treats %s as public', ip => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})

describe('checkUrl', () => {
  const rejects = (url: string) => {
    let err: unknown
    try { checkUrl(url) } catch (e) { err = e }
    expect(err, url).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
  }

  it('accepts public https addresses and drops the fragment', () => {
    expect(checkUrl('https://ocw.mit.edu/courses/6-006/pages/syllabus/#top').toString())
      .toBe('https://ocw.mit.edu/courses/6-006/pages/syllabus/')
    expect(checkUrl('https://example.com:443/a').host).toBe('example.com')
  })

  it('rejects other schemes, ports and embedded credentials', () => {
    for (const url of ['http://example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'https://example.com:8443/', 'https://user:pass@example.com/', 'not a url']) {
      rejects(url)
    }
  })

  it('rejects private and local IP literals in every spelling', () => {
    for (const url of [
      'https://127.0.0.1/', 'https://10.1.2.3/', 'https://192.168.0.1/', 'https://169.254.169.254/latest/meta-data/',
      'https://2130706433/', 'https://0x7f.1/', 'https://0177.0.0.1/', // decimal, hex and octal forms of 127.0.0.1
      'https://[::1]/', 'https://[fe80::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/',
    ]) {
      rejects(url)
    }
  })
})

describe('fetchPage', () => {
  const rejectsPrivate = async (url: string) => {
    const err = await fetchPage(url).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
    expect((err as HttpError).message).toMatch(/nicht öffentlich/)
  }

  it('refuses host names that resolve to a local address', async () => {
    await rejectsPrivate('https://localhost/')
  })

  it('refuses host names where any resolved address is private (DNS rebinding)', async () => {
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _opts: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => {
      cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])
    }) as unknown as typeof dns.lookup)
    await rejectsPrivate('https://rebind.example/')
    expect(lookup).toHaveBeenCalled()
  })
})
